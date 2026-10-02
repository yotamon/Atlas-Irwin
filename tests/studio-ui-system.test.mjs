import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Studio stylesheet entrypoint keeps canonical layers above legacy compatibility", async () => {
  const css = await source("app/studio/design-system/index.css");
  const orderedImports = [
    "./tokens.css",
    "./legacy-compat.generated.css",
    "./primitives.css",
    "./primitive-contract.css",
    "./shell.css",
    "./shell-contract.css",
    "./compositions.css",
    "./architecture.css",
    "./editorial-surfaces.css",
    "./ux-hardening.css",
  ];

  let previous = -1;
  for (const file of orderedImports) {
    const index = css.indexOf(file);
    assert.notEqual(index, -1, `${file} must be wired into the Studio stylesheet entrypoint`);
    assert.ok(index > previous, `${file} must remain after the previous canonical layer import`);
    assert.equal(css.indexOf(file, index + 1), -1, `${file} must be imported exactly once`);
    previous = index;
  }
});

test("Studio tokens own shared page, density, control and icon geometry", async () => {
  const css = await source("app/studio/design-system/tokens.css");
  for (const token of [
    "--en-page-narrow",
    "--en-page-max",
    "--en-page-wide",
    "--en-page-gutter",
    "--en-section-gap",
    "--en-content-gap",
    "--en-control-sm",
    "--en-control-md",
    "--en-control-lg",
    "--en-icon-sm",
    "--en-icon-md",
    "--en-icon-lg",
    "--en-space-7",
    "--en-radius-md",
    "--en-success",
    "--en-positive",
    "--en-shadow",
    "--en-surface-inset",
    "--en-surface-inset-compact",
  ]) {
    assert.match(css, new RegExp(`${token.replaceAll("-", "\\-")}\\s*:`), `${token} must be canonical`);
  }
});

test("Studio UI module exposes semantic page, form, action and state primitives", async () => {
  const ui = await source("components/studio/ui.tsx");
  for (const component of [
    "Page",
    "PageHeader",
    "Section",
    "SectionHeader",
    "Stack",
    "Grid",
    "Split",
    "Actions",
    "ActionBar",
    "Field",
    "FormSection",
    "FormGrid",
    "StatePanel",
    "EmptyState",
    "LoadingState",
  ]) {
    assert.match(ui, new RegExp(`export function ${component}\\b`), `${component} must remain available`);
  }
});

test("Studio shell delegates page gutters to the page architecture", async () => {
  const shell = await source("app/studio/design-system/shell-contract.css");
  assert.match(shell, /\.studio-root \.studio-main\s*\{[^}]*padding:\s*0;/s);

  const architecture = await source("app/studio/design-system/architecture.css");
  assert.match(architecture, /:where\(\.studio-page, \.studio-v2-page\)[^{]*\{[^}]*--en-page-gutter/s);
});

test("Release creation uses canonical page and form composition", async () => {
  const page = await source("app/studio/(protected)/releases/new/page.tsx");
  const form = await source("components/studio/release-form.tsx");
  assert.match(page, /<Page width="narrow"/);
  assert.match(form, /<FormGrid/);
  assert.match(form, /<ActionBar/);
  assert.doesNotMatch(form, /className="form-grid/);
});

test("Legacy v2 structural sections are normalized to editorial surfaces", async () => {
  const css = await source("app/studio/design-system/editorial-surfaces.css");
  assert.match(css, /:where\(\.v2-section\)/);
  assert.match(css, /border-radius:\s*0/);
  assert.match(css, /background:\s*transparent/);
  assert.match(css, /data-surface="feature"/);
});


test("Processing state styles the status marker without collapsing its label", async () => {
  const css = await source("app/studio/design-system/motion.css");
  assert.match(css, /ensemblis-processing-steps li > span:first-child/);
  assert.match(css, /ensemblis-processing-steps li > span:nth-child\(2\)[^{]*\{[^}]*min-width:\s*0/s);
  assert.match(css, /ensemblis-processing h2[^{]*\{[^}]*max-width:\s*min\(15ch,\s*100%\)[^}]*overflow-wrap:\s*break-word/s);
  assert.doesNotMatch(css, /ensemblis-processing-steps li > span,\s*\n\.ensemblis-loading \.ensemblis-processing-steps li > span\s*\{/);
});

test("Studio hardening keeps legacy split layouts inside the usable workspace", async () => {
  const css = await source("app/studio/design-system/ux-hardening.css");
  assert.match(css, /:where\(\.studio-page, \.studio-v2-page\) > \*\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(css, /:where\(\.growth-recommendation, \.growth-bottleneck\)\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /@media \(max-width:\s*1240px\)[^{]*\{[\s\S]*?\.growth-command-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width:\s*1180px\)[^{]*\{[\s\S]*?\.track-object-overview\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});


test("Framed Studio surfaces always keep content away from their edges", async () => {
  const patterns = await source("app/studio/design-system/patterns.css");
  const compositions = await source("app/studio/design-system/compositions.css");

  assert.match(patterns, /\.track-object-primary,[\s\S]*?\.distribution-section[\s\S]*?\)\s*\{[^}]*padding:\s*var\(--en-surface-inset\)/);
  assert.match(patterns, /\.v2-provider-lock\s*\{[^}]*padding:\s*var\(--en-surface-inset-compact\)/);
  assert.match(compositions, /\.growth-recommendation\s*\{[^}]*padding:\s*var\(--en-surface-inset\)/);
  assert.match(compositions, /\.growth-bottleneck\s*\{[^}]*padding:\s*var\(--en-surface-inset\)/);
  assert.match(compositions, /\.inbox-approval-section\s*\{[^}]*padding-inline:\s*var\(--en-surface-inset\)/);
  assert.match(compositions, /\.inbox-protected-section\s*\{[^}]*padding-inline:\s*var\(--en-surface-inset\)/);
});

test("Canonical spacing aliases cover migrated Studio styles", async () => {
  const tokens = await source("app/studio/design-system/tokens.css");
  for (const token of [
    "--en-space-7",
    "--en-radius-md",
    "--en-success",
    "--en-positive",
    "--en-shadow",
  ]) {
    assert.match(tokens, new RegExp(`${token.replaceAll("-", "\\-")}\\s*:`), `${token} must resolve in the canonical token layer`);
  }
});
