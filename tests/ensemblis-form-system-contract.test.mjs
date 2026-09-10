import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Base UI owns modal focus, dismissal and accessibility behavior", async () => {
  const packageJson = JSON.parse(await source("package.json"));
  const dialog = await source("components/studio/dialog.tsx");
  const commandPalette = await source("components/studio/command-palette.tsx");
  const overlays = await source("app/studio/design-system/overlays.css");

  assert.equal(packageJson.dependencies?.["@base-ui/react"], "1.8.0");
  for (const component of [dialog, commandPalette]) {
    assert.ok(component.includes('from "@base-ui/react/dialog"'));
    assert.ok(component.includes("<BaseDialog.Root"));
    assert.ok(component.includes("<BaseDialog.Portal>"));
    assert.ok(component.includes("<BaseDialog.Popup"));
  }

  for (const manualBehavior of ["FOCUSABLE_SELECTOR", "trapFocus", "document.body.style.overflow"]) {
    assert.equal(dialog.includes(manualBehavior), false, `Dialog must not reimplement ${manualBehavior}`);
    assert.equal(commandPalette.includes(manualBehavior), false, `Command Palette must not reimplement ${manualBehavior}`);
  }

  assert.ok(dialog.includes("initialFocus={initialFocusRef}"));
  assert.ok(dialog.includes("finalFocus={returnFocusRef}"));
  assert.ok(commandPalette.includes("initialFocus={inputRef}"));
  assert.ok(commandPalette.includes("finalFocus={triggerRef}"));

  assert.ok(overlays.includes("Base UI portals render under <body>"));
  assert.ok(overlays.includes(".ensemblis-dialog-backdrop"));
  assert.ok(overlays.includes(".ensemblis-command-backdrop"));
  assert.equal(overlays.includes(".studio-root .ensemblis-dialog-backdrop"), false, "portal chrome must not depend on being rendered inside .studio-root");
});

test("behavior-heavy form controls use Base UI without replacing native text inputs", async () => {
  const controls = await source("components/studio/form-controls.tsx");
  const tooltip = await source("components/studio/tooltip.tsx");
  const ui = await source("components/studio/ui.tsx");
  const onboardingForms = await source("components/studio/onboarding-forms.tsx");
  const onboardingPage = await source("app/studio/onboarding/page.tsx");
  const css = await source("app/studio/design-system/controls.css");
  const index = await source("app/studio/design-system/index.css");
  const release = await source("components/studio/release-form.tsx");
  const video = await source("components/studio/video-director/create-project-form.tsx");
  const artistSettings = await source("app/studio/(protected)/settings/artist/page.tsx");
  const autonomySettings = await source("app/studio/(protected)/settings/autonomy/page.tsx");
  const aiSettings = await source("app/studio/(protected)/settings/ai/page.tsx");

  assert.ok(controls.includes('from "@base-ui/react/select"'));
  assert.ok(controls.includes('from "@base-ui/react/switch"'));
  assert.ok(controls.includes("<BaseSelect.Root"));
  assert.ok(controls.includes("<BaseSelect.Label"));
  assert.ok(controls.includes("<BaseSelect.Portal>"));
  assert.ok(controls.includes("<BaseSwitch.Root"));
  assert.ok(controls.includes("name={name}"), "Base UI controls must participate in native form submission");

  assert.ok(tooltip.includes('from "@base-ui/react/tooltip"'));
  assert.ok(tooltip.includes("<BaseTooltip.Trigger"));
  assert.ok(tooltip.includes("<BaseTooltip.Portal>"));
  assert.ok(ui.includes("<EnsemblisTooltip label={label}>"));
  assert.equal(ui.includes("data-tooltip={label}"), false, "shared tooltips must not regress to CSS-only hover hints");

  assert.ok(index.includes('"./controls.css" layer(ensemblis-patterns)'));
  for (const selector of [
    ".ensemblis-select-trigger",
    ".ensemblis-select-popup",
    ".ensemblis-switch-field",
    ".ensemblis-switch-thumb",
    ".ensemblis-tooltip-popup",
  ]) assert.ok(css.includes(selector), `${selector} must have canonical Ensemblis chrome`);
  assert.ok(css.includes("prefers-reduced-motion: reduce"));

  assert.ok(release.includes("<SelectField"));
  assert.ok(video.includes("<SelectField"));
  assert.ok(artistSettings.includes("<SelectField"));
  assert.ok(artistSettings.includes("<SwitchField"));
  assert.ok(autonomySettings.includes("<SwitchField"));
  assert.ok(aiSettings.includes("<SwitchField"));
  assert.ok(onboardingForms.includes("<SelectField"));
  assert.ok(onboardingForms.includes("<SwitchField"));
  assert.ok(onboardingForms.includes("<Field"), "onboarding keeps native text/number inputs inside the canonical field shell");
  assert.ok(onboardingPage.includes("<OnboardingIdentityForm"));
  assert.ok(onboardingPage.includes("<OnboardingOperatingForm"));
  assert.equal(onboardingPage.includes("<select name=\"project_type\""), false, "first-run onboarding must not regress to bespoke selects");
  assert.ok(release.includes("<input"), "native text/date inputs remain the low-JS default");
});

test("release forms return structured validation instead of throwing known field errors", async () => {
  const form = await source("components/studio/release-form.tsx");
  const adapter = await source("app/studio/release-form-actions.ts");
  const state = await source("lib/studio/form-state.ts");
  const mutation = await source("app/studio/release-actions-v2.ts");

  assert.ok(form.includes('useActionState(saveReleaseV2WithState, EMPTY_ACTION_FORM_STATE)'));
  assert.ok(form.includes('error={error("title")}'));
  assert.ok(form.includes('aria-invalid={Boolean(error("title")) || undefined}'));
  assert.ok(form.includes('<Notice tone="danger" role="alert">'));

  assert.ok(adapter.includes("releaseFormSchema.safeParse"));
  assert.ok(adapter.includes("z.flattenError(parsed.error).fieldErrors"));
  assert.ok(adapter.includes("await saveReleaseV2(formData)"));
  assert.equal(adapter.includes(".parse("), false, "known form validation must use safeParse and return errors");

  assert.ok(state.includes("ActionFieldErrors"));
  assert.ok(state.includes("firstActionFieldError"));
  assert.ok(mutation.includes("requireStudioAdmin"), "the existing authenticated mutation remains the final write boundary");
});

test("retired feedback CSS stays canonical and cannot drift back into compatibility", async () => {
  const compiler = await source("scripts/build-studio-css.mjs");
  const index = await source("app/studio/design-system/index.css");
  const feedback = await source("app/studio/design-system/feedback.css");
  const loading = await source("app/studio/design-system/loading.css");

  for (const retired of [
    "shared-interactions.css",
    "loading-polish.css",
    "studio-v2-safety.css",
    "ensemblis-root-isolation.css",
    "ensemblis-states.css",
    "ux-consolidation.css",
  ]) {
    assert.equal(compiler.includes(`app/studio/${retired}`), false, `${retired} must remain retired`);
  }

  assert.ok(index.includes('"./feedback.css" layer(ensemblis-patterns)'));
  assert.ok(index.includes('"./loading.css" layer(ensemblis-motion)'));
  assert.ok(feedback.includes(".v2-provider-lock"));
  assert.ok(feedback.includes(".upload-item-copy"));
  assert.ok(feedback.includes('.field[data-invalid="true"]'));
  assert.ok(loading.includes(".ensemblis-workspace-loading"));
  assert.ok(loading.includes("prefers-reduced-motion: reduce"));
}
);
