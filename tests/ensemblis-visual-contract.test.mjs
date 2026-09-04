import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Ensemblis shell is the final authority over legacy Studio styling", async () => {
  const layout = await readFile("app/studio/layout.tsx", "utf8");
  const legacyIndex = layout.indexOf('import "./studio.css"');
  const ensemblisIndex = layout.indexOf('import "./ensemblis-shell.css"');

  assert.ok(legacyIndex >= 0, "legacy Studio compatibility stylesheet is missing");
  assert.ok(ensemblisIndex > legacyIndex, "Ensemblis shell must load after legacy Studio CSS");
});

test("Ensemblis visual tokens own product chrome without Atlas public-site assets", async () => {
  const shell = await readFile("app/studio/ensemblis-shell.css", "utf8");

  for (const token of [
    "--en-bg:",
    "--en-surface:",
    "--en-ink:",
    "--en-accent:",
    "--en-violet:",
    "--en-mint:",
    "--en-danger:",
  ]) {
    assert.ok(shell.includes(token), `${token} is missing from the Ensemblis visual system`);
  }

  assert.ok(shell.includes("--s-bg: var(--en-bg)"));
  assert.ok(shell.includes("--s-accent: var(--en-accent)"));
  assert.ok(shell.includes("isolation: isolate"));

  for (const atlasArtifact of ["hero-bg", "paper-card", "texture-image", "Montage-Demo"]) {
    assert.equal(shell.includes(atlasArtifact), false, `${atlasArtifact} leaked into Ensemblis product chrome`);
  }
});

test("Ensemblis browser and installed-app chrome use the product identity", async () => {
  const layout = await readFile("app/studio/layout.tsx", "utf8");
  const manifest = await readFile("app/studio/manifest.ts", "utf8");
  const mark = await readFile("public/ensemblis-mark.svg", "utf8");

  assert.ok(layout.includes('export const viewport: Viewport'));
  assert.ok(layout.includes('themeColor: "#080b09"'));
  assert.ok(layout.includes('colorScheme: "dark"'));
  assert.ok(layout.includes('/ensemblis-mark.svg'));
  assert.ok(manifest.includes("ENSEMBLIS_PRODUCT"));
  assert.ok(mark.includes("#B7F36A"));
  assert.ok(mark.includes("#8A7CFF"));
  assert.ok(mark.includes("#5CE1C6"));
});

test("legacy warm Atlas-era chrome cannot become the Ensemblis source of truth", async () => {
  const shell = await readFile("app/studio/ensemblis-shell.css", "utf8");

  for (const legacyColor of ["#d8c9a8", "#d6cfbe", "#d8c79f", "#d8cbaa", "#bdb29b", "#c7bda7"]) {
    assert.equal(shell.toLowerCase().includes(legacyColor), false, `${legacyColor} should not define Ensemblis chrome`);
  }

  for (const selector of [
    ".studio-root .panel-head h2",
    ".studio-root .studio-table th",
    ".studio-root .field > span",
    ".studio-root .studio-sidebar nav a",
    ".studio-root .v2-inbox-item.important",
  ]) {
    assert.ok(shell.includes(selector), `${selector} is not covered by the Ensemblis compatibility skin`);
  }
});
