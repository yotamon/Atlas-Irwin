import type { CreativeReferenceContext } from "./creative-context";
import type { CreativeGenerationRequest } from "./creative-provider-types";
import type { CreativeRoute } from "./creative-router";
import type { CreativeTreatment } from "./creative-treatment";

export type CreativeQualityCheck = {
  id: string;
  label: string;
  passed: boolean;
  severity: "blocking" | "warning";
  detail: string;
};

export type CreativeProductionGate = {
  version: "creative-production-gate-v1";
  publishabilityPolicyVersion: "artist-specificity-v2";
  passed: boolean;
  score: number;
  specificityScore: number;
  checks: CreativeQualityCheck[];
  failures: string[];
  warnings: string[];
  humanVisualReviewRequired: true;
};

function check(id: string, label: string, passed: boolean, severity: CreativeQualityCheck["severity"], detail: string): CreativeQualityCheck {
  return { id, label, passed, severity, detail };
}

function requestRatio(request: CreativeGenerationRequest) {
  return request.aspectRatio;
}

function hasAntiSlopCoverage(treatment: CreativeTreatment) {
  const text = treatment.antiPatterns.join(" ").toLowerCase();
  const concepts = [
    /cyberpunk|neon/,
    /festival|crowd/,
    /chrome|humanoid|anonymous model|fashion model/,
    /particle|hologram|ai aesthetic|ai slop/,
  ];
  return concepts.filter((pattern) => pattern.test(text)).length >= 3;
}

function generationPromptKeepsFinishingOut(treatment: CreativeTreatment) {
  const prompt = treatment.generationPrompt.toLowerCase();
  const finishingTokens = ["text", "typography", "logo", "ui"];
  const exclusionLanguage = /(no |without |exclude|do not|don't|avoid)/i.test(treatment.generationPrompt);
  return exclusionLanguage && finishingTokens.some((token) => prompt.includes(token));
}

function sourceDiversity(treatment: CreativeTreatment) {
  return new Set(treatment.shotPlan.map((shot) => shot.sourcePreference)).size;
}

function tokens(value: string) {
  return Array.from(new Set(
    value.toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4),
  ));
}

function tokenOverlap(reference: string, candidate: string) {
  const referenceTokens = new Set(tokens(reference));
  if (!referenceTokens.size) return 0;
  const candidateTokens = new Set(tokens(candidate));
  let hits = 0;
  for (const token of referenceTokens) if (candidateTokens.has(token)) hits += 1;
  return hits / referenceTokens.size;
}

function treatmentSpecificity(treatment: CreativeTreatment, context: CreativeReferenceContext) {
  const candidate = [
    treatment.concept,
    treatment.creativePromise,
    treatment.heroMotif,
    treatment.cameraLanguage,
    treatment.lighting,
    treatment.texture,
    treatment.editingGrammar,
    treatment.sourceStrategy,
    treatment.audioPlan,
    ...treatment.shotPlan.flatMap((shot) => [shot.purpose, shot.visual, shot.audioTreatment]),
  ].join(" ");
  const releaseOverlap = tokenOverlap(context.release.visualDirection, candidate);
  const brandOverlap = tokenOverlap(context.brand.visualWorld, candidate);
  const continuityOverlap = tokenOverlap(context.brand.continuityRules, candidate);
  const sceneOverlap = context.selectedAudioScene
    ? Math.max(
        tokenOverlap(context.selectedAudioScene.name, candidate),
        tokenOverlap(context.selectedAudioScene.description, candidate),
        tokenOverlap(context.selectedAudioScene.type.replaceAll("_", " "), candidate),
      )
    : 0;
  const explicitMusic = Boolean(context.selectedAudioScene || context.lyrics.analysisCurrent || context.audioReferenceUrl);
  const referenceDepth = Math.min(1, (context.imageReferences.length + context.videoReferences.length + context.identityAssets.length) / 4);
  const heroSpecific = tokens(treatment.heroMotif).length >= 4 && !/generic|abstract visual|neon city|festival crowd|chrome humanoid/i.test(treatment.heroMotif);
  const score = Math.round(Math.min(100,
    releaseOverlap * 24 +
    brandOverlap * 20 +
    continuityOverlap * 10 +
    sceneOverlap * 18 +
    (explicitMusic ? 12 : 0) +
    referenceDepth * 8 +
    (heroSpecific ? 8 : 0),
  ));
  return {
    score,
    detail: `Specificity ${score}/100: release ${Math.round(releaseOverlap * 100)}%, brand ${Math.round(brandOverlap * 100)}%, music-scene ${Math.round(sceneOverlap * 100)}%, reference depth ${Math.round(referenceDepth * 100)}%.`,
  };
}

function firstSecondIsDeliberate(treatment: CreativeTreatment) {
  const first = treatment.shotPlan[0];
  if (!first) return false;
  if (first.startSeconds > 0.25) return false;
  const opening = `${first.purpose} ${first.visual} ${first.onScreenText}`.toLowerCase();
  return !/logo sting|logo intro|establishing logo|title card only/.test(opening);
}

function realFirstSourcePolicy(treatment: CreativeTreatment) {
  const strategy = treatment.sourceStrategy.toLowerCase();
  const generatedShots = treatment.shotPlan.filter((shot) => shot.sourcePreference === "generated").length;
  const realOrArtworkShots = treatment.shotPlan.filter((shot) => ["real", "artwork", "mixed", "motion_graphics"].includes(shot.sourcePreference)).length;
  const explicitPreference = /real|artist|artwork|existing|reference|source material/.test(strategy);
  return explicitPreference && (realOrArtworkShots >= generatedShots || generatedShots <= 1);
}

export function assessCreativeProductionPreflight(input: {
  treatment: CreativeTreatment;
  context: CreativeReferenceContext;
  route: CreativeRoute;
}): CreativeProductionGate {
  const { treatment, context, route } = input;
  const checks: CreativeQualityCheck[] = [];
  const packageSpec = treatment.platformPackage;
  const specificity = treatmentSpecificity(treatment, context);

  checks.push(check(
    "visual-lineage",
    "Visual lineage is strong enough",
    context.cohesionScore >= 50,
    "blocking",
    context.cohesionScore >= 50
      ? `Creative context cohesion is ${context.cohesionScore}/100.`
      : `Creative context cohesion is only ${context.cohesionScore}/100. Add release artwork or approved artist references before paid generation.`,
  ));

  checks.push(check(
    "artist-specificity",
    "Concept is specific to this artist and release",
    specificity.score >= 34,
    "blocking",
    specificity.score >= 34
      ? specificity.detail
      : `${specificity.detail} Paid generation is blocked because the direction is still too transferable to another artist.`,
  ));

  checks.push(check(
    "platform-geometry",
    "Provider geometry matches the platform package",
    requestRatio(route.request) === packageSpec.aspectRatio,
    "blocking",
    `Expected ${packageSpec.aspectRatio} (${packageSpec.width}×${packageSpec.height}); provider request is ${requestRatio(route.request)}.`,
  ));

  checks.push(check(
    "anti-slop",
    "Treatment explicitly excludes generic AI tropes",
    hasAntiSlopCoverage(treatment),
    "blocking",
    hasAntiSlopCoverage(treatment)
      ? "Treatment carries explicit anti-pattern coverage."
      : "Treatment does not exclude enough high-risk generic AI motifs.",
  ));

  checks.push(check(
    "deterministic-finishing",
    "Typography and identity stay out of generative rendering",
    generationPromptKeepsFinishingOut(treatment),
    "blocking",
    generationPromptKeepsFinishingOut(treatment)
      ? "Generative plate prompt explicitly keeps text/logo/UI in deterministic finishing."
      : "Raw generation prompt must explicitly exclude rendered text, logos and UI.",
  ));

  const validShots = treatment.shotPlan.length > 0 && treatment.shotPlan.every((shot, index) =>
    shot.index === index + 1 && shot.endSeconds > shot.startSeconds,
  );
  checks.push(check(
    "shot-plan",
    "Shot plan is executable",
    validShots,
    "blocking",
    validShots ? `${treatment.shotPlan.length} ordered production shot${treatment.shotPlan.length === 1 ? "" : "s"}.` : "Shot timing or ordering is invalid.",
  ));

  checks.push(check(
    "first-second",
    "First second has an intentional hook",
    route.outputKind === "image" || firstSecondIsDeliberate(treatment),
    "blocking",
    route.outputKind === "image"
      ? "Static creative is evaluated by first-frame composition."
      : firstSecondIsDeliberate(treatment)
        ? "The first shot begins immediately and is not a logo-only intro."
        : "Video must open on a deliberate visual/music hook instead of setup or a logo sting.",
  ));

  const outputKind = route.outputKind;
  const duration = route.request.durationSeconds ?? null;
  const durationFits = outputKind === "image" || duration === null || (
    (packageSpec.minDurationSeconds === null || duration >= packageSpec.minDurationSeconds) &&
    (packageSpec.maxDurationSeconds === null || duration <= packageSpec.maxDurationSeconds)
  );
  checks.push(check(
    "duration",
    "Duration fits the native package",
    durationFits,
    "blocking",
    outputKind === "image" ? "Static output has no duration constraint." : `Requested duration is ${duration ?? "provider default"}s.`,
  ));

  const hasMusicContext = Boolean(context.audioReferenceUrl || context.selectedAudioScene || context.lyrics.analysisCurrent);
  checks.push(check(
    "music-context",
    "Paid video direction is tied to verified music context",
    outputKind === "image" || hasMusicContext,
    outputKind === "video" ? "blocking" : "warning",
    context.selectedAudioScene
      ? `Uses Audio Scene: ${context.selectedAudioScene.name}.`
      : context.lyrics.analysisCurrent
        ? "Lyrics Intelligence supplies current semantic music context."
        : context.audioReferenceUrl
          ? "Canonical audio reference is available."
          : outputKind === "video"
            ? "Paid music video generation is blocked until a canonical audio, selected Audio Scene or current Lyrics Intelligence context is available."
            : "No portable audio, selected Audio Scene or current Lyrics Intelligence is available.",
  ));

  const selectedScenePortable = !context.selectedAudioScene || Boolean(context.selectedAudioScene.previewUrl);
  checks.push(check(
    "audio-scene-portability",
    "Selected Audio Scene is portable",
    selectedScenePortable,
    "warning",
    selectedScenePortable
      ? context.selectedAudioScene ? `${context.selectedAudioScene.name} has a portable preview.` : "Canonical master/audio context is used."
      : `${context.selectedAudioScene?.name || "Selected Audio Scene"} is conceptual only; do not silently substitute the canonical master during finishing.`,
  ));

  const sourceMix = sourceDiversity(treatment);
  checks.push(check(
    "source-strategy",
    "Production is not dependent on one synthetic source",
    outputKind === "image" || sourceMix >= 2 || treatment.shotPlan.every((shot) => shot.sourcePreference !== "generated"),
    "warning",
    outputKind === "image"
      ? treatment.sourceStrategy
      : `${sourceMix} source categor${sourceMix === 1 ? "y" : "ies"} across the shot plan. ${treatment.sourceStrategy}`,
  ));

  checks.push(check(
    "real-first",
    "Real artist material and established artwork lead the source plan",
    realFirstSourcePolicy(treatment),
    "warning",
    realFirstSourcePolicy(treatment)
      ? "Source strategy is real-first and uses generation as supporting production material."
      : "Prefer real artist material, established artwork and deterministic motion before generated plates.",
  ));

  const failures = checks.filter((item) => !item.passed && item.severity === "blocking").map((item) => item.detail);
  const warnings = checks.filter((item) => !item.passed && item.severity === "warning").map((item) => item.detail);
  const weightedFailures = checks.filter((item) => !item.passed).reduce((sum, item) => sum + (item.severity === "blocking" ? 16 : 5), 0);
  const score = Math.max(0, Math.min(100, 100 - weightedFailures - Math.max(0, 50 - specificity.score) * 0.35));

  return {
    version: "creative-production-gate-v1",
    publishabilityPolicyVersion: "artist-specificity-v2",
    passed: failures.length === 0,
    score: Math.round(score),
    specificityScore: specificity.score,
    checks,
    failures,
    warnings,
    humanVisualReviewRequired: true,
  };
}

export function assertCreativeProductionGate(gate: CreativeProductionGate) {
  if (!gate.passed) {
    throw new Error(`Creative production gate blocked generation: ${gate.failures.join(" ")}`);
  }
}
