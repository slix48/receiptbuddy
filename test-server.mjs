import { strict as assert } from "node:assert";
import { request } from "node:http";
import { createStaticServer } from "./server.mjs";

const server = createStaticServer();

function listen(serverToStart) {
  return new Promise((resolve) => {
    serverToStart.listen(0, "127.0.0.1", () => {
      resolve(serverToStart.address().port);
    });
  });
}

function close(serverToClose) {
  return new Promise((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fetchLocal(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body,
          });
        });
      }
    );

    clientRequest.on("error", reject);
    clientRequest.end();
  });
}

const port = await listen(server);

try {
  const home = await fetchLocal(port, "/");
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /ReceiptBuddy/);
  assert.match(home.headers["content-type"], /text\/html/);
  assert.equal(home.headers["cache-control"], "no-store");

  const head = await fetchLocal(port, "/", "HEAD");
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");

  const traversal = await fetchLocal(port, "/%2e%2e%2fserver.mjs");
  assert.equal(traversal.statusCode, 403);

  const badEncoding = await fetchLocal(port, "/%E0%A4%A");
  assert.equal(badEncoding.statusCode, 400);

  const missing = await fetchLocal(port, "/missing-file.js");
  assert.equal(missing.statusCode, 404);

  const post = await fetchLocal(port, "/", "POST");
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
} finally {
  await close(server);
}

console.log("Server checks passed.");
