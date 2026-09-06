import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const studioModulesRoot = fileURLToPath(new URL("../components/studio", import.meta.url));
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function withoutComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "");
}

function rawChrome(value) {
  const css = withoutComments(value);
  return css.match(/#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})\b|rgba?\(\s*\d|hsla?\(\s*-?\d/i)?.[0] ?? null;
}

async function moduleCssFiles(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".module.css")) result.push(path);
    }
  }
  await walk(root);
  return result;
}

test("Studio has one canonical Design System stylesheet entrypoint", async () => {
  const layout = await source("app/studio/layout.tsx");
  const imports = [...layout.matchAll(/import\s+["'](\.\/[^"']+\.css)["'];/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./design-system/index.css"]);

  const index = await source("app/studio/design-system/index.css");
  for (const file of ["legacy-compat.generated.css", "tokens.css", "primitives.css", "patterns.css", "shell.css", "accessibility.css"]) {
    assert.ok(index.includes(file), `${file} is missing from the Design System entrypoint`);
  }
  assert.ok(index.includes("ensemblis-compat"));
  assert.ok(index.indexOf("ensemblis-compat") < index.indexOf("ensemblis-primitives"));
  assert.ok(index.indexOf("ensemblis-primitives") < index.indexOf("ensemblis-shell"));
});

test("tokens.css is the only authoritative product-chrome value source", async () => {
  const tokens = await source("app/studio/design-system/tokens.css");
  for (const token of [
    "--en-bg:", "--en-surface:", "--en-surface-raised:", "--en-ink:", "--en-muted:",
    "--en-line:", "--en-accent:", "--en-violet:", "--en-mint:", "--en-danger:", "--en-warning:",
    "--en-radius:", "--en-space-4:", "--en-text-md:", "--en-duration-fast:", "--en-shadow-md:", "--en-focus-ring:",
  ]) assert.ok(tokens.includes(token), `${token} is missing from canonical tokens`);
  assert.equal(tokens.includes("--s-"), false);

  for (const file of ["primitives.css", "patterns.css", "shell.css", "accessibility.css"]) {
    const css = await source(`app/studio/design-system/${file}`);
    assert.equal(/^\s*--en-[\w-]+\s*:/m.test(withoutComments(css)), false, `${file} redeclares canonical tokens`);
    assert.equal(rawChrome(css), null, `${file} contains raw product chrome: ${rawChrome(css)}`);
    assert.equal(css.includes("--s-"), false, `${file} uses legacy --s-* tokens`);
  }
});

test("legacy Studio CSS is compiled into a token-only, low-priority compatibility layer", async () => {
  await exec(process.execPath, ["scripts/build-studio-css.mjs"], { cwd: repoRoot });
  const generated = await source("app/studio/design-system/legacy-compat.generated.css");
  assert.ok(generated.includes("AUTO-GENERATED"));
  assert.ok(generated.includes("compatibility source: app/studio/studio.css"));
  assert.ok(generated.includes("compatibility source: app/studio/ux-consolidation.css"));
  assert.equal(rawChrome(generated), null, `compiled compatibility CSS contains raw chrome: ${rawChrome(generated)}`);
  assert.equal(generated.includes("--s-"), false);
  assert.equal(generated.includes("--studio-surface"), false);
  assert.equal(/--(?:border|card|foreground|muted-foreground)\b/.test(generated), false);
  assert.equal(/^\s*--en-[\w-]+\s*:/m.test(withoutComments(generated)), false, "compatibility CSS may reference but never declare canonical tokens");
});

test("all Studio CSS Modules consume Ensemblis tokens instead of private chrome", async () => {
  const files = await moduleCssFiles(studioModulesRoot);
  assert.ok(files.length >= 8, "expected the Studio component CSS modules to be audited");
  for (const absolute of files) {
    const css = await readFile(absolute, "utf8");
    const relative = absolute.replaceAll("\\", "/").split("/components/studio/").at(-1);
    assert.equal(rawChrome(css), null, `${relative} contains raw chrome: ${rawChrome(css)}`);
    for (const legacy of ["--s-", "--studio-surface", "--border", "--card", "--foreground", "--muted-foreground"]) {
      assert.equal(css.includes(legacy), false, `${relative} still uses ${legacy}`);
    }
  }
});

test("canonical primitives own reusable control and surface chrome", async () => {
  const primitives = await source("app/studio/design-system/primitives.css");
  for (const selector of [
    ".studio-root .button {",
    ".studio-root .text-button {",
    ".studio-root .field {",
    ".studio-root .studio-page-header {",
    ".studio-root .studio-panel {",
    ".studio-root .empty-state {",
    ".studio-root .studio-table {",
  ]) assert.ok(primitives.includes(selector), `${selector} is not owned by primitives.css`);

  for (const file of ["patterns.css", "shell.css", "accessibility.css"]) {
    const css = await source(`app/studio/design-system/${file}`);
    assert.equal(css.includes(".studio-root .button {"), false, `${file} redefines Button`);
    assert.equal(css.includes(".studio-root .field {"), false, `${file} redefines Field`);
    assert.equal(css.includes(".studio-root .studio-panel {"), false, `${file} redefines Panel`);
  }
});

test("Design System compilation is mandatory in install, dev, test and build paths", async () => {
  const pkg = JSON.parse(await source("package.json"));
  assert.equal(pkg.scripts.predev, "node scripts/build-studio-css.mjs");
  assert.equal(pkg.scripts.prebuild, "node scripts/build-studio-css.mjs");
  assert.equal(pkg.scripts["pretest:studio"], "node scripts/build-studio-css.mjs");
  assert.ok(pkg.scripts.postinstall.includes("build-studio-css.mjs"));
});

test("browser theme metadata is the documented CSS-variable exception and stays synchronized", async () => {
  const layout = await source("app/studio/layout.tsx");
  const tokens = await source("app/studio/design-system/tokens.css");
  const tokenColor = tokens.match(/--en-bg:\s*(#[\da-fA-F]{6})\s*;/)?.[1]?.toLowerCase();
  const metadataColor = layout.match(/themeColor:\s*["'](#[\da-fA-F]{6})["']/)?.[1]?.toLowerCase();
  assert.equal(metadataColor, tokenColor);
  assert.ok(layout.includes("Browser metadata cannot reference CSS custom properties"));
});
