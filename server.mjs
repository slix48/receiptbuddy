import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5178);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendText(response, status, message, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(message);
}

export function createStaticServer(rootDir = root) {
  const rootPath = normalize(rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`);
  const comparableRoot = rootPath.toLowerCase();

  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed", { Allow: "GET, HEAD" });
      return;
    }

    let requestedPath;
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      sendText(response, 400, "Bad request");
      return;
    }

    const filePath = normalize(join(rootPath, requestedPath));

    if (!filePath.toLowerCase().startsWith(comparableRoot)) {
      sendText(response, 403, "Forbidden");
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");

      response.writeHead(200, {
        "Content-Type": types[extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      const stream = createReadStream(filePath);
      stream.on("error", () => {
        if (!response.headersSent) {
          sendText(response, 500, "Read error");
        } else {
          response.destroy();
        }
      });
      stream.pipe(response);
    } catch {
      sendText(response, 404, "Not found");
    }
  });
}

const server = createStaticServer();

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  server.listen(port, () => {
    console.log(`ReceiptBuddy running at http://localhost:${port}`);
  });
}
