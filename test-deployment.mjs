import { strict as assert } from "node:assert";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function assertExists(path) {
  await access(path);
}

const vercel = await readJson("vercel.json");
assert.equal(vercel.framework, null);
assert.equal(vercel.buildCommand, "npm run build");
assert.equal(vercel.outputDirectory, "dist");

const manifest = await readJson("manifest.json");
assert.equal(manifest.start_url, "/?v=6");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.ok(manifest.icons.some((icon) => icon.src === "assets/icon.svg" && icon.type === "image/svg+xml"));

for (const file of ["index.html", "styles.css", "app.mjs", "manifest.json", "sw.js"]) {
  await assertExists(join("dist", file));
}

await assertExists(join("dist", "assets", "icon.svg"));
await assertExists(join("dist", "assets", "receipt-scan-hero.png"));

const serviceWorker = await readFile("sw.js", "utf8");
const shellPaths = [...serviceWorker.matchAll(/"([^"]+)"/g)]
  .map((match) => match[1])
  .filter((path) => path.startsWith("/"));

for (const shellPath of shellPaths) {
  const cleanPath = shellPath.split("?")[0];
  if (cleanPath === "/") continue;
  await assertExists(join("dist", cleanPath.replace(/^\//, "")));
}

console.log("Deployment checks passed.");
