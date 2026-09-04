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
  passed: boolean;
  score: number;
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

export function assessCreativeProductionPreflight(input: {
  treatment: CreativeTreatment;
  context: CreativeReferenceContext;
  route: CreativeRoute;
}): CreativeProductionGate {
  const { treatment, context, route } = input;
  const checks: CreativeQualityCheck[] = [];
  const packageSpec = treatment.platformPackage;

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
    "music-context",
    "Creative direction is tied to the track",
    Boolean(context.audioReferenceUrl || context.selectedAudioScene || context.lyrics.analysisCurrent),
    "warning",
    context.selectedAudioScene
      ? `Uses Audio Scene: ${context.selectedAudioScene.name}.`
      : context.lyrics.analysisCurrent
        ? "Lyrics Intelligence supplies current semantic music context."
        : context.audioReferenceUrl
          ? "Canonical audio reference is available."
          : "No portable audio, selected Audio Scene or current Lyrics Intelligence is available.",
  ));

  const failures = checks.filter((item) => !item.passed && item.severity === "blocking").map((item) => item.detail);
  const warnings = checks.filter((item) => !item.passed && item.severity === "warning").map((item) => item.detail);
  const weightedFailures = checks.filter((item) => !item.passed).reduce((sum, item) => sum + (item.severity === "blocking" ? 18 : 6), 0);
  const score = Math.max(0, 100 - weightedFailures);

  return {
    version: "creative-production-gate-v1",
    passed: failures.length === 0,
    score,
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
