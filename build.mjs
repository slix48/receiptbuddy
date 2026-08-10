import { cp, mkdir, rm } from "node:fs/promises";

const files = ["index.html", "styles.css", "app.mjs"];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });

for (const file of files) {
  await cp(file, `dist/${file}`);
}

await cp("assets", "dist/assets", { recursive: true });
console.log("Built static site in dist/.");