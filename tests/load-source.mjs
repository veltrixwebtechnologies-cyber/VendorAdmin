import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

// Load actual TypeScript modules without writing generated files or starting Vite.
export function sourceLoader(root, mocks = {}) {
  const require = createRequire(path.join(root, "package.json"));
  const cache = new Map();
  function url(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    let code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    code = code.replace(/from\s+(["'])([^"']+)\1/g, (_, quote, specifier) => {
      if (mocks[specifier])
        return `from ${JSON.stringify("data:text/javascript;base64," + Buffer.from(mocks[specifier]).toString("base64"))}`;
      if (!specifier.startsWith(".") && !specifier.startsWith("@/"))
        return `from ${JSON.stringify(pathToFileURL(require.resolve(specifier)).href)}`;
      let target = specifier.startsWith("@/")
        ? path.join(root, "src", specifier.slice(2))
        : path.resolve(path.dirname(file), specifier);
      if (!path.extname(target)) target += fs.existsSync(target + ".ts") ? ".ts" : ".tsx";
      return `from ${JSON.stringify(url(target))}`;
    });
    const result =
      "data:text/javascript;base64," +
      Buffer.from(code + "\n//# sourceURL=" + pathToFileURL(file).href).toString("base64");
    cache.set(file, result);
    return result;
  }
  return (file) => import(url(path.resolve(root, file)));
}
