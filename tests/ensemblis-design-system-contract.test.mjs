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
const withoutComments = (value) => value.replace(/\/\*[\s\S]*?\*\//g, "");
const rawChrome = (value) => withoutComments(value).match(/#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})\b|rgba?\(\s*\d|hsla?\(\s*-?\d/i)?.[0] ?? null;

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

test("Studio has one canonical Design System stylesheet entrypoint with contextual layout in the correct cascade position", async () => {
  const layout = await source("app/studio/layout.tsx");
  const imports = [...layout.matchAll(/import\s+["'](\.\/[^"']+\.css)["'];/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./design-system/index.css"]);
  const index = await source("app/studio/design-system/index.css");
  for (const file of ["legacy-compat.generated.css", "tokens.css", "primitives.css", "patterns.css", "shell.css", "compositions.css", "accessibility.css"]) assert.ok(index.includes(file), `${file} is missing from the Design System entrypoint`);
  assert.ok(index.indexOf("ensemblis-tokens") < index.indexOf("ensemblis-primitives"));
  assert.ok(index.indexOf("ensemblis-primitives") < index.indexOf("ensemblis-compat"), "legacy contextual layout must be able to override primitive anatomy while it is migrated");
  assert.ok(index.indexOf("ensemblis-compat") < index.indexOf("ensemblis-patterns"));
  assert.ok(index.indexOf("ensemblis-patterns") < index.indexOf("ensemblis-shell"));
  assert.ok(index.indexOf("ensemblis-shell") < index.indexOf("ensemblis-compositions"));
  assert.ok(index.indexOf("ensemblis-compositions") < index.indexOf("ensemblis-accessibility"));
});

test("tokens.css is the only authoritative product-chrome value source", async () => {
  const tokens = await source("app/studio/design-system/tokens.css");
  for (const token of ["--en-bg:", "--en-surface:", "--en-surface-raised:", "--en-ink:", "--en-muted:", "--en-line:", "--en-accent:", "--en-violet:", "--en-mint:", "--en-danger:", "--en-warning:", "--en-radius:", "--en-space-4:", "--en-text-md:", "--en-duration-fast:", "--en-shadow-md:", "--en-focus-ring:"]) assert.ok(tokens.includes(token), `${token} is missing from canonical tokens`);
  assert.equal(tokens.includes("--s-"), false);
  for (const file of ["primitives.css", "patterns.css", "shell.css", "compositions.css", "accessibility.css"]) {
    const css = await source(`app/studio/design-system/${file}`);
    assert.equal(/^\s*--en-[\w-]+\s*:/m.test(withoutComments(css)), false, `${file} redeclares canonical tokens`);
    assert.equal(rawChrome(css), null, `${file} contains raw product chrome: ${rawChrome(css)}`);
    assert.equal(css.includes("--s-"), false, `${file} uses legacy --s-* tokens`);
  }
});

test("legacy Studio CSS is compiled into a token-only compatibility bridge", async () => {
  await exec(process.execPath, ["scripts/build-studio-css.mjs"], { cwd: repoRoot });
  const generated = await source("app/studio/design-system/legacy-compat.generated.css");
  assert.ok(generated.includes("AUTO-GENERATED"));
  assert.ok(generated.includes("compatibility source: app/studio/studio.css"));
  assert.ok(generated.includes("compatibility source: app/studio/ux-consolidation.css"));
  assert.equal(rawChrome(generated), null, `compiled compatibility CSS contains raw chrome: ${rawChrome(generated)}`);
  assert.equal(generated.includes("--s-"), false);
  assert.equal(/--studio-surface(?![\w-])/.test(generated), false);
  assert.equal(/--(?:border|card|foreground|muted-foreground)(?![\w-])/.test(generated), false);
  assert.equal(/^\s*--en-[\w-]+\s*:/m.test(withoutComments(generated)), false, "compatibility CSS may reference but never declare canonical --en-* tokens");
});

test("all Studio CSS Modules consume Ensemblis tokens instead of private chrome", async () => {
  const files = await moduleCssFiles(studioModulesRoot);
  assert.ok(files.length >= 8, "expected the Studio component CSS modules to be audited");
  for (const absolute of files) {
    const css = await readFile(absolute, "utf8");
    const relative = absolute.replaceAll("\\", "/").split("/components/studio/").at(-1);
    assert.equal(rawChrome(css), null, `${relative} contains raw chrome: ${rawChrome(css)}`);
    for (const legacy of ["--s-", "--studio-surface", "--border", "--card", "--foreground", "--muted-foreground"]) assert.equal(css.includes(legacy), false, `${relative} still uses ${legacy}`);
  }
});

test("canonical primitives own reusable control and surface chrome", async () => {
  const primitives = await source("app/studio/design-system/primitives.css");
  for (const selector of [".studio-root .button {", ".studio-root .text-button {", ".studio-root .field {", ".studio-root .studio-page-header {", ".studio-root .studio-panel {", ".studio-root .empty-state {", ".studio-root .studio-table {"]) assert.ok(primitives.includes(selector), `${selector} is not owned by primitives.css`);
  for (const file of ["patterns.css", "shell.css", "compositions.css", "accessibility.css"]) {
    const css = await source(`app/studio/design-system/${file}`);
    assert.equal(css.includes(".studio-root .button {"), false, `${file} redefines Button`);
    assert.equal(css.includes(".studio-root .field {"), false, `${file} redefines Field`);
    assert.equal(css.includes(".studio-root .studio-panel {"), false, `${file} redefines Panel`);
  }
});

test("canonical React UI API exposes primitives plus semantic product patterns", async () => {
  const ui = await source("components/studio/ui.tsx");
  for (const exported of ["Button", "ButtonLink", "IconButton", "PageHeader", "Panel", "Surface", "EmptyState", "Status", "Field", "Tabs", "Disclosure", "Submit"]) assert.ok(ui.includes(`export function ${exported}`), `${exported} is missing from the Studio UI API`);
  const patterns = await source("components/studio/patterns.tsx");
  for (const exported of ["SectionHeading", "PriorityHero", "DecisionQueue", "DecisionRow", "MetricStrip", "CalmState"]) assert.ok(patterns.includes(`export function ${exported}`), `${exported} is missing from the semantic component API`);
});

test("mobile navigation is structurally limited to four direct destinations plus More", async () => {
  const product = await source("lib/ensemblis-product.ts");
  const navigation = await source("components/studio/mobile-navigation.tsx");
  const compositions = await source("app/studio/design-system/compositions.css");
  assert.ok(product.includes("ENSEMBLIS_MOBILE_WORK_NAV"));
  assert.ok(product.includes("ENSEMBLIS_MOBILE_MORE_NAV"));
  assert.ok(navigation.includes("ENSEMBLIS_MOBILE_WORK_NAV.map"));
  assert.ok(navigation.includes("ENSEMBLIS_MOBILE_MORE_NAV.map"));
  assert.equal(navigation.includes("ENSEMBLIS_WORK_NAV.map"), false, "desktop navigation must never be mapped directly into the mobile tab bar");
  assert.ok(compositions.includes("grid-template-columns: repeat(5, minmax(0, 1fr))"));
  assert.ok(compositions.includes("white-space: nowrap"));
});

test("Today uses semantic hierarchy and previews rather than dumping the whole decision queue", async () => {
  const today = await source("app/studio/(protected)/page.tsx");
  const needsYou = await source("app/studio/(protected)/needs-you/page.tsx");
  assert.ok(today.includes("<PriorityHero"));
  assert.ok(today.includes("<DecisionQueue"));
  assert.ok(today.includes("needsYou.slice(0, 3)"));
  assert.ok(needsYou.includes("Blocking decisions"));
  assert.ok(needsYou.includes("Everything else"));
  assert.equal(needsYou.includes("One queue, no duplicate tasks"), false, "internal architecture copy must not compete with the user's decisions");
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
