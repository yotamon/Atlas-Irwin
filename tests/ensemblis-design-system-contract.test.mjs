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
const canonicalDesignFiles = [
  "primitives.css",
  "patterns.css",
  "feedback.css",
  "overlays.css",
  "shell.css",
  "compositions.css",
  "workflows.css",
  "motion.css",
  "loading.css",
  "choreography.css",
  "interaction-states.css",
  "atmosphere.css",
  "art-direction.css",
  "accessibility.css",
];

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
  for (const file of ["legacy-compat.generated.css", "tokens.css", ...canonicalDesignFiles]) assert.ok(index.includes(file), `${file} is missing from the Design System entrypoint`);
  assert.ok(index.indexOf("ensemblis-tokens") < index.indexOf("ensemblis-compat"));
  assert.ok(index.indexOf("ensemblis-compat") < index.indexOf("ensemblis-primitives"), "legacy compatibility must stay below canonical primitives so primitive anatomy remains authoritative");
  assert.ok(index.indexOf("ensemblis-primitives") < index.indexOf("ensemblis-patterns"));
  assert.ok(index.indexOf("ensemblis-patterns") < index.indexOf("ensemblis-shell"));
  assert.ok(index.indexOf("ensemblis-shell") < index.indexOf("ensemblis-compositions"));
  assert.ok(index.indexOf("ensemblis-compositions") < index.indexOf("ensemblis-workflows"));
  assert.ok(index.indexOf("ensemblis-workflows") < index.indexOf("ensemblis-motion"));
  assert.ok(index.indexOf("ensemblis-motion") < index.indexOf("ensemblis-art-direction"));
  assert.ok(index.indexOf("ensemblis-art-direction") < index.indexOf("ensemblis-accessibility"));
});

test("tokens.css is the only authoritative product-chrome value source", async () => {
  const tokens = await source("app/studio/design-system/tokens.css");
  for (const token of ["--en-bg:", "--en-surface:", "--en-surface-raised:", "--en-ink:", "--en-muted:", "--en-line:", "--en-accent:", "--en-violet:", "--en-mint:", "--en-danger:", "--en-warning:", "--en-radius:", "--en-space-4:", "--en-text-md:", "--en-duration-fast:", "--en-shadow-md:", "--en-focus-ring:"]) assert.ok(tokens.includes(token), `${token} is missing from canonical tokens`);
  assert.equal(tokens.includes("--s-"), false);
  for (const file of canonicalDesignFiles) {
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
  for (const retired of ["ux-consolidation.css", "shared-interactions.css", "loading-polish.css", "studio-v2-safety.css", "ensemblis-root-isolation.css", "ensemblis-states.css"]) {
    assert.equal(generated.includes(`compatibility source: app/studio/${retired}`), false, `${retired} must stay retired from the compatibility bridge`);
  }
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

  const chromeOwnershipFiles = canonicalDesignFiles.filter((file) => !["primitives.css", "motion.css", "interaction-states.css"].includes(file));
  for (const file of chromeOwnershipFiles) {
    const css = await source(`app/studio/design-system/${file}`);
    assert.equal(css.includes(".studio-root .button {"), false, `${file} redefines Button`);
    assert.equal(css.includes(".studio-root .field {"), false, `${file} redefines Field`);
    assert.equal(css.includes(".studio-root .studio-panel {"), false, `${file} redefines Panel`);
  }

  const motion = await source("app/studio/design-system/motion.css");
  const motionButtonBlock = motion.match(/\.studio-root \.button \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(motionButtonBlock.includes("transform"), "motion layer must be allowed to extend Button movement");
  for (const property of ["padding:", "min-height:", "font-size:", "border-radius:", "background:", "color:"]) {
    assert.equal(motionButtonBlock.includes(property), false, `motion.css must not take Button chrome ownership via ${property}`);
  }
});

test("canonical React UI API exposes primitives plus semantic product patterns", async () => {
  const ui = await source("components/studio/ui.tsx");
  for (const exported of ["Button", "ButtonLink", "IconButton", "PageHeader", "Panel", "Surface", "EmptyState", "Status", "Field", "Tabs", "Disclosure", "Submit"]) assert.ok(ui.includes(`export function ${exported}`), `${exported} is missing from the Studio UI API`);
  const patterns = await source("components/studio/patterns.tsx");
  for (const exported of ["SectionHeading", "PriorityHero", "DecisionQueue", "DecisionRow", "MetricStrip", "CalmState"]) assert.ok(patterns.includes(`export function ${exported}`), `${exported} is missing from the semantic component API`);
  assert.ok(patterns.includes("<h2 id={id}>") && patterns.includes("id?: string"), "SectionHeading must support real labelled-region relationships");
});

test("motion and processing are canonical, accessible and reduced-motion safe", async () => {
  const motion = await source("app/studio/design-system/motion.css");
  const choreography = await source("app/studio/design-system/choreography.css");
  const interactions = await source("app/studio/design-system/interaction-states.css");
  const artDirection = await source("app/studio/design-system/art-direction.css");
  const stage = await source("components/studio/studio-motion-stage.tsx");
  const processing = await source("components/studio/processing-state.tsx");
  const submit = await source("components/studio/submit-button.tsx");

  assert.ok(motion.includes("prefers-reduced-motion: reduce"));
  assert.ok(choreography.includes("prefers-reduced-motion: reduce"));
  assert.ok(interactions.includes("prefers-reduced-motion: reduce"));
  assert.ok(artDirection.includes("prefers-reduced-motion: reduce"));
  assert.ok(stage.includes("AnimatePresence"));
  assert.ok(processing.includes('role="status"'));
  assert.ok(processing.includes('aria-live="polite"'));
  assert.ok(submit.includes("useFormStatus"));
  assert.ok(submit.includes("aria-busy={pending}"));
});
