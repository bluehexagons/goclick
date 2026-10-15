"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// A fresh module graph and DOM/transport per test. The files are compiled from
// the same TypeScript as the production bundles; no application globals leak.
function frontend(globals, overrides = {}) {
  const context = vm.createContext(globals);
  const modules = new Map();
  function load(name) {
    const key = path.basename(name, ".js");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(key)) return modules.get(key).exports;
    const file = path.join(__dirname, "../../..", ".basaltwater/frontend-tests", `${key}.js`);
    const module = { exports: {} };
    modules.set(key, module);
    const code = fs.readFileSync(file, "utf8");
    const evaluate = vm.runInContext(
      `(function (exports, require, module) { ${code}\n})`,
      context,
      { filename: file },
    );
    evaluate(module.exports, load, module);
    return module.exports;
  }
  function bundle(name) {
    const file = path.join(__dirname, "../web", `${name}.js`);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    return context;
  }
  return { context, load, bundle };
}
module.exports = { frontend };
