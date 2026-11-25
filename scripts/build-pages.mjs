import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const web = new URL("../internal/webapp/web/", import.meta.url);
const output = new URL("../.basaltwater/pages/", import.meta.url);
const html = await readFile(new URL("index.html", web), "utf8");
const gameRoot = '<html lang="en">';
if (!html.includes(gameRoot)) throw new Error("Could not mark the Pages entry point as offline.");

const assets = [
  "app.css",
  "app.js",
  "favicon.svg",
  "icons.svg",
  "achievement-icons.svg",
  "language-flags.svg",
  "background-grain.svg",
  "button-material.svg",
  "button-glow.svg",
];
const index = html.replace(gameRoot, '<html lang="en" data-offline-only>');
const worker = await readFile(new URL("./pages-worker.js", import.meta.url), "utf8");
const release = createHash("sha256").update(worker).update(index);

// Start fresh so removed files cannot linger in the deployment artifact.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of assets) {
  const contents = await readFile(new URL(asset, web));
  release.update(asset).update(contents);
  await writeFile(new URL(asset, output), contents);
}
await copyFile(new URL("../LICENSE", import.meta.url), new URL("LICENSE", output));
await writeFile(new URL("index.html", output), index);
await writeFile(
  new URL("service-worker.js", output),
  `const pagesRevision = ${JSON.stringify(release.digest("hex"))};\n` +
    `const pagesFiles = ${JSON.stringify(["index.html", ...assets])};\n` +
    worker,
);
