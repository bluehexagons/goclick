import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const testing = process.argv.includes("--tests");
const check = process.argv.includes("--check");
const sourceFiles = (await readdir(path.join(root, "frontend"))).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".d.ts"),
);
const output = await build({
  absWorkingDir: root,
  entryPoints: testing
    ? sourceFiles.map((file) => `frontend/${file}`)
    : ["frontend/app.ts", "frontend/admin.ts"],
  bundle: !testing,
  format: testing ? "cjs" : "iife",
  platform: testing ? "node" : "browser",
  target: "es2022",
  outdir: testing ? ".basaltwater/frontend-tests" : "internal/webapp/web",
  banner: { js: "// Generated from frontend/*.ts by npm run build. Do not edit directly." },
  legalComments: "none",
  write: false,
  logLevel: "warning",
});
let stale = false;
for (const file of output.outputFiles) {
  if (check) {
    const current = await readFile(file.path, "utf8").catch(() => "");
    if (current !== file.text) {
      console.error(`Stale frontend bundle: ${path.relative(root, file.path)}. Run npm run build.`);
      stale = true;
    }
  } else {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
}
if (stale) process.exitCode = 1;
