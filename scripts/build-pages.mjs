import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const web = new URL("../internal/webapp/web/", import.meta.url);
const output = new URL("../.basaltwater/pages/", import.meta.url);
const html = await readFile(new URL("index.html", web), "utf8");
const gameRoot = '<html lang="en">';
if (!html.includes(gameRoot)) throw new Error("Could not mark the Pages entry point as offline.");

// Only publish files used by the game. Start fresh so removed files cannot
// linger in the deployment artifact.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of [
  "app.css",
  "app.js",
  "favicon.svg",
  "icons.svg",
  "achievement-icons.svg",
  "language-flags.svg",
  "background-grain.svg",
  "button-material.svg",
  "button-glow.svg",
]) {
  await copyFile(new URL(asset, web), new URL(asset, output));
}
await copyFile(new URL("../LICENSE", import.meta.url), new URL("LICENSE", output));
await writeFile(
  new URL("index.html", output),
  html.replace(gameRoot, '<html lang="en" data-offline-only>'),
);
