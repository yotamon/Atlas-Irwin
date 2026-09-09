import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AutoMix stays a DJ performance workspace instead of regressing to generic cards", async () => {
  const page = await source("app/studio/(protected)/music/automix/page.tsx");
  const studio = await source("components/studio/automix-studio.tsx");
  const css = await source("components/studio/automix-studio-v2.module.css");

  assert.ok(page.includes('className="studio-v2-page automix-workspace-page"'));
  assert.equal(page.includes('className="studio-v2-page music-workspace-page"'), false, "AutoMix must not inherit the oversized Music route hero");

  for (const marker of [
    "styles.hero",
    "styles.technicalRider",
    "styles.intentList",
    "styles.runningOrder",
    "styles.sessionsStage",
    "styles.activeJob",
    "styles.plan",
    "styles.transitionPreview",
  ]) assert.ok(studio.includes(marker), `${marker} is missing from the AutoMix composition`);

  assert.ok(studio.includes("<ProcessingState"), "AutoMix must reuse the canonical processing language");
  assert.ok(studio.includes('aria-pressed={purpose === item.id}'));
  assert.ok(studio.includes('aria-pressed={active}'));
  assert.ok(studio.includes("Let Ensemblis choose"), "candidate-pool curation must stay explicit in the DJ workspace");
  assert.ok(studio.includes("Preview transition"), "verified transition auditioning must stay next to the plan");
  assert.equal(studio.includes("styles.heroCard"), false, "generic hero cards must not return");
  assert.equal(studio.includes("styles.panel"), false, "generic repeated panels must not return");
  assert.equal(studio.includes("styles.progress"), false, "generic progress bars must not replace canonical processing states");

  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.includes(":global(.button)"), "CSS Modules must target canonical global Button chrome explicitly");
  assert.ok(css.includes(".transitionPreview"), "transition preview chrome must remain part of the canonical AutoMix stylesheet");
  assert.equal(css.includes("--en-space-7"), false, "AutoMix must only reference defined Studio spacing tokens");
  assert.equal(css.includes(".heroCard"), false);
  assert.equal(/(^|\n)\.panel\s*\{/.test(css), false);
});
