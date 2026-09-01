import "server-only";

import { runAtlasAiTask } from "@/lib/ai/control-plane";
import { conciseLyricsPromptContext } from "@/lib/lyrics-intelligence/context";
import { loadAtlasCreativeDna, type AtlasCreativeDna } from "./creative-dna";
import type { CreativeReferenceContext } from "./creative-context";
import { socialPlatformPackage, type SocialOutputKind, type SocialPlatformPackage } from "./platform-packages";

export type CreativeShot = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  purpose: string;
  visual: string;
  camera: string;
  sourcePreference: "real" | "artwork" | "generated" | "motion_graphics" | "mixed";
  audioTreatment: string;
  onScreenText: string;
};

export type CreativeTreatment = {
  version: "creative-director-v1";
  concept: string;
  creativePromise: string;
  emotionalArc: string;
  heroMotif: string;
  cameraLanguage: string;
  lighting: string;
  texture: string;
  editingGrammar: string;
  typographyDirection: string;
  sourceStrategy: string;
  antiPatterns: string[];
  audioPlan: string;
  shotPlan: CreativeShot[];
  generationPrompt: string;
  finishingNotes: string[];
  confidence: number;
  platformPackage: SocialPlatformPackage;
};

type ContentInput = {
  id: string;
  title: string;
  platform: string;
  format: string;
  hook_text: string | null;
  caption: string | null;
  cta: string | null;
  content_angle: string | null;
  production_notes: string | null;
  visual_prompt: string | null;
  audio_timestamp_start: number | null;
  audio_timestamp_end: number | null;
  campaign_id: string | null;
  release_id: string | null;
};

const treatmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "concept",
    "creativePromise",
    "emotionalArc",
    "heroMotif",
    "cameraLanguage",
    "lighting",
    "texture",
    "editingGrammar",
    "typographyDirection",
    "sourceStrategy",
    "antiPatterns",
    "audioPlan",
    "shotPlan",
    "generationPrompt",
    "finishingNotes",
    "confidence",
  ],
  properties: {
    concept: { type: "string", minLength: 12, maxLength: 500 },
    creativePromise: { type: "string", minLength: 8, maxLength: 300 },
    emotionalArc: { type: "string", minLength: 8, maxLength: 300 },
    heroMotif: { type: "string", minLength: 6, maxLength: 300 },
    cameraLanguage: { type: "string", minLength: 6, maxLength: 300 },
    lighting: { type: "string", minLength: 4, maxLength: 240 },
    texture: { type: "string", minLength: 4, maxLength: 240 },
    editingGrammar: { type: "string", minLength: 8, maxLength: 400 },
    typographyDirection: { type: "string", minLength: 4, maxLength: 300 },
    sourceStrategy: { type: "string", minLength: 8, maxLength: 400 },
    antiPatterns: { type: "array", minItems: 4, maxItems: 14, items: { type: "string", minLength: 3, maxLength: 160 } },
    audioPlan: { type: "string", minLength: 8, maxLength: 500 },
    shotPlan: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "startSeconds", "endSeconds", "purpose", "visual", "camera", "sourcePreference", "audioTreatment", "onScreenText"],
        properties: {
          index: { type: "integer", minimum: 1, maximum: 10 },
          startSeconds: { type: "number", minimum: 0, maximum: 60 },
          endSeconds: { type: "number", minimum: 0.1, maximum: 60 },
          purpose: { type: "string", minLength: 3, maxLength: 220 },
          visual: { type: "string", minLength: 5, maxLength: 420 },
          camera: { type: "string", minLength: 3, maxLength: 220 },
          sourcePreference: { type: "string", enum: ["real", "artwork", "generated", "motion_graphics", "mixed"] },
          audioTreatment: { type: "string", minLength: 3, maxLength: 260 },
          onScreenText: { type: "string", maxLength: 180 },
        },
      },
    },
    generationPrompt: { type: "string", minLength: 30, maxLength: 1800 },
    finishingNotes: { type: "array", minItems: 3, maxItems: 12, items: { type: "string", minLength: 3, maxLength: 220 } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} satisfies Record<string, unknown>;

const DIRECTOR_INSTRUCTIONS = `You are the production creative director for Atlas Irwin, an independent electronic / nu-disco artist.
Your job is not to make "AI content". Your job is to design a production-grade social creative that could plausibly come from a strong independent music art department using a mix of real footage, artwork, motion design, editing and selective generative media.

NON-NEGOTIABLE RULES:
- Start from the supplied music, release world, visual references and content objective. Do not invent a new aesthetic for every post.
- Treat creativeDna as evidence. Approved patterns are useful continuity signals, not templates to clone. Rejected patterns are negative evidence and must not be repeated merely because they look on-brand.
- The hardAntiPatterns inside creativeDna are mandatory exclusions and should be reflected in antiPatterns whenever relevant to the concept.
- Prefer real Atlas source material and existing artwork when available. Generative imagery is supporting production material, not the default identity.
- One strong visual idea is better than five unrelated spectacular ideas.
- Avoid generic cyberpunk, random neon cities, chrome humanoids, anonymous fashion models, fake festival crowds, floating particles, meaningless holograms, synthetic luxury, motivational copy and generic "OUT NOW" advertising.
- Do not ask image/video models to render the Atlas logo, legible captions, lyric typography, UI, buttons or promotional text. Those belong to deterministic post-production.
- If lyric quoting is not explicitly permitted in the supplied lyrics context, use lyrics semantically only and do not reconstruct them.
- Build the edit around the supplied musical hook, selected Audio Scene, lyric moment or track section. The visual must serve the music.
- Platform adaptation is creative direction, not just cropping. Respect the supplied platform package and safe areas.
- First-second framing must be deliberate. Do not waste the opening on a logo sting or establishing shot unless the concept truly depends on it.
- Give every shot a production purpose and a preferred source type.
- generationPrompt describes only the raw generative plate(s): photography/cinematography, action, material, light, camera and continuity. Explicitly exclude rendered text/logos/UI from generative output.
- finishingNotes describe deterministic edit, grade, typography, compositing and mastering work after generation.
- Keep the work sophisticated, tactile, musical and human. Restraint is a quality signal.`;

function treatmentQuality(value: Omit<CreativeTreatment, "version" | "platformPackage">) {
  const failures: string[] = [];
  if (value.shotPlan.some((shot) => shot.endSeconds <= shot.startSeconds)) failures.push("Every shot must end after it starts.");
  const ordered = [...value.shotPlan].sort((a, b) => a.index - b.index);
  if (ordered.some((shot, index) => shot.index !== index + 1)) failures.push("Shot indexes must be sequential from 1.");
  if (value.antiPatterns.length < 4) failures.push("The treatment needs explicit anti-slop exclusions.");
  if (!/text|typograph|logo|ui/i.test(value.generationPrompt) || !/(no|without|exclude|do not)/i.test(value.generationPrompt)) {
    failures.push("The generation prompt must explicitly keep text/logo/UI out of generative rendering.");
  }
  const tropeHits = ["generic cyberpunk", "fake festival crowd", "random neon", "chrome humanoid"].filter((term) => value.generationPrompt.toLowerCase().includes(term));
  if (tropeHits.length) failures.push(`Generation prompt contains banned generic trope: ${tropeHits.join(", ")}.`);
  const score = Math.max(0, 1 - failures.length * 0.24);
  return { passed: failures.length === 0, score, failures };
}

function durationHint(content: ContentInput, outputKind: SocialOutputKind, platformPackage: SocialPlatformPackage) {
  if (outputKind === "image") return null;
  if (content.audio_timestamp_start !== null && content.audio_timestamp_end !== null && content.audio_timestamp_end > content.audio_timestamp_start) {
    return Math.min(platformPackage.maxDurationSeconds ?? 60, Math.max(platformPackage.minDurationSeconds ?? 4, content.audio_timestamp_end - content.audio_timestamp_start));
  }
  return Math.min(platformPackage.maxDurationSeconds ?? 15, 12);
}

function contextPayload(content: ContentInput, context: CreativeReferenceContext, creativeDna: AtlasCreativeDna, platformPackage: SocialPlatformPackage, outputKind: SocialOutputKind) {
  return {
    content: {
      title: content.title,
      platform: content.platform,
      format: content.format,
      hook: content.hook_text,
      caption: content.caption,
      cta: content.cta,
      angle: content.content_angle,
      productionNotes: content.production_notes,
      existingVisualBrief: content.visual_prompt,
      audioWindow: content.audio_timestamp_start !== null && content.audio_timestamp_end !== null
        ? { startSeconds: content.audio_timestamp_start, endSeconds: content.audio_timestamp_end }
        : null,
    },
    output: {
      kind: outputKind,
      durationHintSeconds: durationHint(content, outputKind, platformPackage),
      package: platformPackage,
    },
    creativeDna,
    release: context.release,
    brand: context.brand,
    references: {
      images: context.imageReferences.map((reference) => ({ role: reference.role, source: reference.source, title: reference.title, reason: reference.reason, isPrimary: reference.isPrimary })),
      videos: context.videoReferences.map((reference) => ({ role: reference.role, source: reference.source, title: reference.title, reason: reference.reason, isPrimary: reference.isPrimary })),
      identity: context.identityAssets.map((reference) => ({ role: reference.role, title: reference.title, reason: reference.reason })),
      cohesionScore: context.cohesionScore,
      summary: context.referenceSummary,
    },
    music: {
      canonicalAudioAvailable: Boolean(context.audioReferenceUrl),
      selectedAudioScene: context.selectedAudioScene,
      candidateAudioScenes: context.audioScenes.slice(0, 6),
      lyrics: conciseLyricsPromptContext(context.lyrics),
    },
  };
}

export async function directContentCreative(input: {
  ownerId: string;
  content: ContentInput;
  context: CreativeReferenceContext;
  outputKind: SocialOutputKind;
}): Promise<{ treatment: CreativeTreatment; generationRunId: string }> {
  const platformPackage = socialPlatformPackage(input.content.platform, input.content.format, input.outputKind);
  const creativeDna = await loadAtlasCreativeDna({ ownerId: input.ownerId, context: input.context });
  const payload = contextPayload(input.content, input.context, creativeDna, platformPackage, input.outputKind);
  const generated = await runAtlasAiTask<Omit<CreativeTreatment, "version" | "platformPackage">>({
    ownerId: input.ownerId,
    task: "marketing.creative_direction",
    purpose: `creative_treatment:${input.content.id}`,
    campaignId: input.content.campaign_id,
    releaseId: input.content.release_id,
    promptVersion: "creative-director-v1",
    schema: treatmentSchema,
    instructions: DIRECTOR_INSTRUCTIONS,
    input: JSON.stringify(payload),
    inputContext: {
      contentItemId: input.content.id,
      platformPackage,
      creativeDnaVersion: creativeDna.version,
      creativeDnaEvidence: creativeDna.evidenceSummary,
      referenceSummary: input.context.referenceSummary,
    },
    qualityGate: treatmentQuality,
    cacheMode: "refresh",
  });

  return {
    treatment: {
      version: "creative-director-v1",
      ...generated.value,
      platformPackage,
    },
    generationRunId: generated.runId,
  };
}
