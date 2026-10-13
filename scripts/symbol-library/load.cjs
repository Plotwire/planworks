// Load the app's symbol modules in plain Node (no Next.js): compiles .jsx and
// lib/*.js on the fly with sucrase (already in node_modules via Tailwind) and
// resolves the "@/" alias. Used by check.cjs and review-sheet.cjs.
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { transform } = require("sucrase");

const ROOT = path.resolve(__dirname, "../..");
const LIB = path.join(ROOT, "lib") + path.sep;

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  return resolve.call(this, request, parent, ...rest);
};

function compile(mod, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const { code } = transform(src, { transforms: ["jsx", "imports"], filePath: filename, production: true });
  mod._compile(code, filename);
}

Module._extensions[".jsx"] = compile;
const plainJs = Module._extensions[".js"];
Module._extensions[".js"] = function (mod, filename) {
  if (filename.startsWith(LIB)) return compile(mod, filename);
  return plainJs(mod, filename);
};

module.exports = {
  ROOT,
  symbols: () => require(path.join(ROOT, "lib/symbols.jsx")),
  library: () => require(path.join(ROOT, "lib/symbolLibrary.js")),
  symbolPdf: () => require(path.join(ROOT, "lib/symbolPdf.js")),
  boq: () => require(path.join(ROOT, "lib/boqTemplate.js")),
};
