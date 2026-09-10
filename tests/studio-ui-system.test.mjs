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
