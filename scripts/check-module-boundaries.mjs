import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const application = JSON.parse(
  fs.readFileSync(path.join(root, "docs/module-refactor/baseline.json"), "utf8"),
).repository;
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
        )
    : [];
const files = walk(sourceRoot).filter((file) => /\.tsx?$/.test(file));
const graph = new Map();
const violations = [];
const relative = (file) => path.relative(sourceRoot, file).split(path.sep).join("/");
function owner(file) {
  const name = relative(file);
  const module = /^modules\/(shopper|seller|delivery|admin)\//.exec(name);
  if (module) return module[1];
  if (/^shared\//.test(name)) return "shared";
  if (/^routes\/admin(?:\.|\/)/.test(name)) return "admin";
  if (/^routes\/(seller|vendor)(?:\.|\/)/.test(name)) return "seller";
  if (/^routes\/partner(?:\.|\/)/.test(name)) return "delivery";
  if (
    application === "ShorelineShopper-GMap" &&
    /^routes\//.test(name) &&
    !/^routes\/(?:__root|api\/|lovable\/)/.test(name)
  )
    return "shopper";
  return null;
}
function resolve(file, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(file), specifier)
      : null;
  return (
    base &&
    [
      base,
      base + ".ts",
      base + ".tsx",
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ].find(
      (candidate) =>
        graph.has(candidate) || (fs.existsSync(candidate) && fs.statSync(candidate).isFile()),
    )
  );
}
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const edges = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const target = resolve(file, specifier);
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly ||
          (node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            !node.importClause.name &&
            node.importClause.namedBindings.elements.every((element) => element.isTypeOnly))
        : node.isTypeOnly;
      if (target) edges.push({ target, typeOnly: Boolean(typeOnly) });
      if (
        /^shared\/core\//.test(relative(file)) &&
        !specifier.startsWith(".") &&
        !["clsx", "tailwind-merge"].includes(specifier)
      )
        violations.push(`${relative(file)}: core import outside neutral contracts: ${specifier}`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const target = resolve(file, node.arguments[0].text);
      if (target) edges.push({ target, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, edges);
}
// Follow legacy forwarding adapters too: changing the spelling of an import
// must not allow a role to reach another role's private implementation.
for (const file of files) {
  const from = owner(file);
  if (!from) continue;
  const visited = new Set();
  function follow(current, trace) {
    if (visited.has(current)) return;
    visited.add(current);
    for (const edge of graph.get(current) ?? []) {
      const to = owner(edge.target);
      if (to && to !== "shared" && to !== from)
        violations.push(
          `${relative(file)} (${from}) reaches ${relative(edge.target)} (${to}) via ${trace}`,
        );
      else if (!to) follow(edge.target, relative(current));
    }
  }
  follow(file, relative(file));
}
// Runtime cycles are separate from type-only dependencies.
const done = new Set(),
  active = new Set();
function cycle(file, trace) {
  if (active.has(file)) {
    const chain = [...trace.slice(trace.indexOf(file)), file];
    if (chain.some((item) => /^modules\/|^shared\//.test(relative(item))))
      violations.push("Runtime cycle: " + chain.map(relative).join(" -> "));
    return;
  }
  if (done.has(file)) return;
  active.add(file);
  for (const edge of graph.get(file) ?? [])
    if (!edge.typeOnly) cycle(edge.target, [...trace, file]);
  active.delete(file);
  done.add(file);
}
for (const file of files) cycle(file, []);
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, "docs/module-refactor/baseline.json"), "utf8"),
);
const ids = [];
for (const file of walk(path.join(sourceRoot, "routes")))
  if (/\.tsx?$/.test(file)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/createFileRoute\(\s*["']([^"']+)["']/g)) ids.push(match[1]);
  }
if (JSON.stringify(ids.sort()) !== JSON.stringify(baseline.routeIds))
  violations.push("Route registrations changed from baseline");
for (const [name, expected] of Object.entries(baseline.migrations)) {
  const file = path.join(root, "supabase/migrations", name);
  const actual =
    fs.existsSync(file) && crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actual !== expected) violations.push(`Historical migration changed: ${name}`);
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(sourceRoot, "shared/core/manifest.json"), "utf8"),
);
const actualCoreFiles = fs
  .readdirSync(path.join(sourceRoot, "shared/core"))
  .filter((name) => name.endsWith(".ts"))
  .sort();
if (JSON.stringify(actualCoreFiles) !== JSON.stringify(Object.keys(manifest.files).sort()))
  violations.push("Unversioned shared core snapshot files");
for (const [name, hash] of Object.entries(manifest.files)) {
  const file = path.join(sourceRoot, "shared/core", name);
  if (
    !fs.existsSync(file) ||
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== hash
  )
    violations.push(`Shared core drift: ${name}`);
}
const canonical = path.join(root, "packages/localshore-core/src");
if (fs.existsSync(canonical))
  for (const name of actualCoreFiles) {
    const source = path.join(canonical, name);
    const expected =
      fs.existsSync(source) &&
      `// Synced from @localshore/core ${manifest.version}; edit packages/localshore-core/src in the Shopper repository.\n` +
        fs.readFileSync(source, "utf8");
    if (
      !expected ||
      fs.readFileSync(path.join(sourceRoot, "shared/core", name), "utf8") !== expected
    )
      violations.push(`Canonical shared core not synchronized: ${name}`);
  }
const unique = [...new Set(violations)];
if (unique.length) {
  console.error(unique.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Module boundaries, runtime dependency graph, ${ids.length} routes, ${Object.keys(baseline.migrations).length} historical migrations, and core ${manifest.version}: OK`,
  );
