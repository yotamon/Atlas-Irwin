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

test("specialist modules resolve through a late Ensemblis screen integration layer", async () => {
  const layout = await readFile("app/studio/layout.tsx", "utf8");
  const screens = await readFile("app/studio/ensemblis-screens.css", "utf8");
  const featureImports = [
    './growth-os.css',
    './video-director.css',
    './ai-control.css',
    './distribution.css',
    './distribution-release.css',
  ];
  const screensIndex = layout.indexOf('import "./ensemblis-screens.css"');

  assert.ok(screensIndex >= 0, "Ensemblis specialist screen integration is not loaded");
  for (const featureImport of featureImports) {
    const featureIndex = layout.indexOf(`import "${featureImport}"`);
    assert.ok(featureIndex >= 0, `${featureImport} is missing from Studio layout`);
    assert.ok(screensIndex > featureIndex, `Ensemblis screen integration must load after ${featureImport}`);
  }

  for (const selector of [
    ".studio-root .growth-north-star-main",
    ".studio-root .video-project-card",
    ".studio-root .distribution-section",
    ".studio-root .ai-budget-track",
    ".studio-root .v2-provider-lock",
  ]) {
    assert.ok(screens.includes(selector), `${selector} is not integrated with Ensemblis chrome`);
  }

  for (const legacyColor of ["#d8c9a8", "#d9d0bd", "#dfd5bd", "#d8cfbd", "#101411"]) {
    assert.equal(screens.toLowerCase().includes(legacyColor), false, `${legacyColor} leaked into Ensemblis screen integration`);
  }
});

test("Ensemblis navigation exposes persistent route orientation", async () => {
  const sidebar = await readFile("components/studio/sidebar.tsx", "utf8");
  const navigation = await readFile("components/studio/sidebar-navigation.tsx", "utf8");
  const screens = await readFile("app/studio/ensemblis-screens.css", "utf8");

  assert.ok(sidebar.includes("StudioPrimaryNavigation"));
  assert.ok(sidebar.includes("StudioAdvancedNavigation"));
  assert.ok(navigation.includes("usePathname"));
  assert.ok(navigation.includes('aria-current={active ? "page" : undefined}'));
  assert.ok(navigation.includes('className={active ? "is-active" : undefined}'));
  assert.ok(screens.includes(".studio-root .studio-sidebar nav a.is-active"));
  assert.ok(screens.includes("box-shadow: inset 2px 0 var(--en-accent)"));
});

test("shared Next root does not serialize public artist chrome into Ensemblis", async () => {
  const rootLayout = await readFile("app/layout.tsx", "utf8");
  const themeInit = await readFile("components/theme-init-script.tsx", "utf8");
  const themeToggle = await readFile("components/theme-toggle.tsx", "utf8");
  const rootLoading = await readFile("app/loading.tsx", "utf8");
  const fontSystem = await readFile("app/font-system.css", "utf8");
  const studioLayout = await readFile("app/studio/layout.tsx", "utf8");
  const rootIsolation = await readFile("app/studio/ensemblis-root-isolation.css", "utf8");

  assert.equal(rootLayout.includes("next/font/local"), false, "public display font is still preloaded from the shared root");
  assert.equal(rootLayout.includes("Montage-Demo"), false, "public display font leaked into the shared root layout");
  assert.equal(rootLayout.includes('data-theme="light"'), false, "Studio still starts from a hardcoded public light theme");
  assert.ok(rootLayout.includes('import "./font-system.css"'));
  assert.ok(fontSystem.includes('@font-face'));
  assert.ok(fontSystem.includes('/fonts/montage_2/Montage-Demo.ttf'));

  assert.ok(themeInit.includes('window.location.pathname === "/studio"'));
  assert.ok(themeInit.includes('window.location.pathname.startsWith("/studio/")'));
  assert.ok(themeInit.includes('document.documentElement.dataset.theme = "dark"'));
  assert.ok(themeInit.includes('localStorage.getItem("site-theme")'));
  assert.ok(themeInit.includes('id="site-theme-init"'));
  assert.equal(themeInit.includes("atlas-theme"), false, "Atlas theme storage leaked into the shared bootstrap");
  assert.equal(themeToggle.includes("atlas-theme"), false, "Atlas theme storage leaked into the shared toggle");
  assert.ok(themeToggle.includes('localStorage.setItem("site-theme", theme)'));

  for (const publicLoadingArtifact of ["hero-scene", "paper-card", "bg-paper", "Loading homepage"]) {
    assert.equal(rootLoading.includes(publicLoadingArtifact), false, `${publicLoadingArtifact} leaked into the shared loading boundary`);
  }
  assert.ok(rootLoading.includes('aria-label="Loading application"'));

  assert.equal(studioLayout.includes("alternates:"), false, "Studio still inherits an Atlas-domain canonical URL");
  assert.ok(studioLayout.includes('import "./ensemblis-root-isolation.css"'));
  assert.ok(rootIsolation.includes("body:has(.studio-root)::before"));
  assert.ok(rootIsolation.includes("body:has(.studio-root)::after"));
  assert.ok(rootIsolation.includes("content: none"));
});
