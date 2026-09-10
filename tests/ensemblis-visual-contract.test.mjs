import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(path, "utf8");

test("Ensemblis Studio loads one canonical Design System entrypoint", async () => {
  const layout = await source("app/studio/layout.tsx");
  assert.ok(layout.includes('import "./design-system/index.css"'));
  for (const legacyImport of ["./studio.css", "./ensemblis-shell.css", "./ensemblis-screens.css", "./ux-polish.css", "./ux-consolidation.css"]) {
    assert.equal(layout.includes(`import "${legacyImport}"`), false, `${legacyImport} must not be imported directly`);
  }
});

test("Ensemblis visual tokens own product chrome without Atlas public-site assets", async () => {
  const tokens = await source("app/studio/design-system/tokens.css");
  const shell = await source("app/studio/design-system/shell.css");

  for (const token of ["--en-bg:", "--en-surface:", "--en-ink:", "--en-accent:", "--en-violet:", "--en-mint:", "--en-danger:"]) {
    assert.ok(tokens.includes(token), `${token} is missing from the Ensemblis visual system`);
  }
  assert.equal(tokens.includes("--s-"), false, "legacy aliases cannot be Design System tokens");
  assert.ok(shell.includes("isolation: isolate"));

  for (const atlasArtifact of ["hero-bg", "paper-card", "texture-image", "Montage-Demo"]) {
    assert.equal(`${tokens}\n${shell}`.includes(atlasArtifact), false, `${atlasArtifact} leaked into Ensemblis product chrome`);
  }
});

test("Ensemblis browser and installed-app chrome use the product identity", async () => {
  const layout = await source("app/studio/layout.tsx");
  const manifest = await source("app/studio/manifest.ts");
  const mark = await source("public/ensemblis-mark.svg");

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
  const canonical = ["tokens.css", "primitives.css", "patterns.css", "shell.css", "accessibility.css"];
  const combined = (await Promise.all(canonical.map((file) => source(`app/studio/design-system/${file}`)))).join("\n").toLowerCase();
  for (const legacyColor of ["#d8c9a8", "#d6cfbe", "#d8c79f", "#d8cbaa", "#bdb29b", "#c7bda7", "#d9d0bd", "#dfd5bd", "#d8cfbd"]) {
    assert.equal(combined.includes(legacyColor), false, `${legacyColor} should not define Ensemblis chrome`);
  }
});

test("specialist modules resolve through canonical Ensemblis patterns", async () => {
  const patterns = await source("app/studio/design-system/patterns.css");
  for (const selector of [
    ".growth-north-star-main",
    ".video-project-card",
    ".distribution-section",
    ".ai-budget-track",
    ".v2-provider-lock",
  ]) assert.ok(patterns.includes(selector), `${selector} is not integrated into canonical Ensemblis patterns`);
});

test("Ensemblis navigation exposes persistent route orientation", async () => {
  const sidebar = await source("components/studio/sidebar.tsx");
  const navigation = await source("components/studio/sidebar-navigation.tsx");
  const shell = await source("app/studio/design-system/shell.css");

  assert.ok(sidebar.includes("StudioPrimaryNavigation"));
  assert.ok(sidebar.includes("StudioAdvancedNavigation"));
  assert.ok(navigation.includes("usePathname"));
  assert.ok(navigation.includes('aria-current={active ? "page" : undefined}'));
  assert.ok(navigation.includes('className={active ? "is-active" : undefined}'));
  assert.ok(shell.includes(".studio-root .studio-sidebar nav a.is-active"));
  assert.ok(shell.includes("box-shadow: inset 2px 0 var(--en-accent)"));
});

test("shared Next root does not serialize public artist chrome into Ensemblis", async () => {
  const rootLayout = await source("app/layout.tsx");
  const themeInit = await source("components/theme-init-script.tsx");
  const themeToggle = await source("components/theme-toggle.tsx");
  const rootLoading = await source("app/loading.tsx");
  const fontSystem = await source("app/font-system.css");
  const studioLayout = await source("app/studio/layout.tsx");
  const shell = await source("app/studio/design-system/shell.css");

  assert.equal(rootLayout.includes("next/font/local"), false, "public display font is still preloaded from the shared root");
  assert.equal(rootLayout.includes("Montage-Demo"), false, "public display font leaked into the shared root layout");
  assert.equal(rootLayout.includes('data-theme="light"'), false, "Studio still starts from a hardcoded public light theme");
  assert.ok(rootLayout.includes('import "./font-system.css"'));
  assert.ok(fontSystem.includes("@font-face"));
  assert.ok(fontSystem.includes("/fonts/montage_2/Montage-Demo.ttf"));

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
  assert.ok(shell.includes("body:has(.studio-root)::before"));
  assert.ok(shell.includes("body:has(.studio-root)::after"));
  assert.ok(shell.includes("content: none"));
});
