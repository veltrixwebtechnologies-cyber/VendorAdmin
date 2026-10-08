import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";

test("module graph, compatibility routes, migrations and shared snapshots remain valid", async () => {
  await import("../scripts/check-module-boundaries.mjs");
  assert.notEqual(process.exitCode, 1);
});

test("shared core is a verified snapshot, not another backend", () => {
  const dir = path.join(process.cwd(), "src/shared/core");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.1.0");
  for (const [name, hash] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), hash);
    assert.doesNotMatch(bytes.toString(), /createClient\(|SERVICE_ROLE_KEY|RAZORPAY_KEY_SECRET/);
  }
  assert.ok(manifest.files["orders.ts"]);
  assert.ok(manifest.files["catalog.ts"]);
  assert.ok(manifest.files["delivery.ts"]);
});

test("shared order contracts cannot import role implementations", () => {
  const dir = path.join(process.cwd(), "src/shared/core");
  for (const name of ["orders.ts", "shopper-order.ts", "seller.ts"]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(dir, name), "utf8"),
      /modules\/|orders-store|demo-payment/,
    );
  }
});

test("extracted runtime syntax trees match the original implementation", () => {
  const baseline = JSON.parse(
    fs.readFileSync("docs/module-refactor/behavior-baseline.json", "utf8"),
  );
  function digest(node) {
    function shape(n) {
      if (ts.isParenthesizedExpression(n)) return shape(n.expression);
      const children = [];
      ts.forEachChild(n, (child) => {
        children.push(shape(child));
      });
      let value = n.text;
      if (ts.isStringLiteral(n) && (/^@\//.test(value) || /^\.\//.test(value)))
        value = path.posix.basename(value);
      return [n.kind, value ?? null, children];
    }
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(Array.isArray(node) ? node.map(shape) : shape(node)))
      .digest("hex");
  }
  for (const entry of baseline) {
    let actual;
    for (const file of entry.targets) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const node of source.statements) {
        if (
          entry.kind === "function" &&
          ts.isFunctionDeclaration(node) &&
          node.name?.text === entry.name
        )
          actual = digest(node.body);
        if (entry.kind === "class" && ts.isClassDeclaration(node) && node.name?.text === entry.name)
          actual = digest([...node.members]);
        if (entry.kind === "variable" && ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations)
            if (declaration.name.getText(source) === entry.name)
              actual = digest(declaration.initializer);
      }
    }
    assert.equal(actual, entry.hash, `${entry.original}: ${entry.name} runtime behavior changed`);
  }
});
