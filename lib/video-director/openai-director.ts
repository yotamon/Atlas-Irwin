import "server-only";

import { atlasAiGatewayConfigured, normalizeGatewayModel } from "@/lib/ai/gateway";
import { runAtlasAiTask } from "@/lib/ai/control-plane";
import { strictQualityResult, type AtlasQualityGate } from "@/lib/ai/quality";
import type { AtlasAiTaskType } from "@/lib/ai/tasks";
import { conciseLyricsPromptContext } from "@/lib/lyrics-intelligence/context";
import type {
  MusicVideoCreativeDirector,
  ProductionPlan,
  StoryboardShot,
  StoryboardShotRevisionInput,
  VideoConcept,
  VideoProjectContext,
  VisualBible,
} from "./creative-director";
import { parseVideoCreativeBrief } from "./domain";

const SHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "start_ms", "end_ms", "description", "prompt", "negative_prompt", "camera",
    "transition_in", "transition_out", "vertical_safe", "vertical_focus",
    "generation_priority", "reuse_strategy", "capability_profile",
  ],
  properties: {
    start_ms: { type: "integer", minimum: 0 },
    end_ms: { type: "integer", minimum: 1 },
    description: { type: "string" },
    prompt: { type: "string" },
    negative_prompt: { type: "string" },
    camera: { type: "string" },
    transition_in: { type: "string" },
    transition_out: { type: "string" },
    vertical_safe: { type: "boolean" },
    vertical_focus: { type: "string", enum: ["left", "center", "right"] },
    generation_priority: { type: "string", enum: ["cost", "balanced", "quality", "consistency", "capability"] },
    reuse_strategy: { type: "string", enum: ["unique", "reuse_source", "continuation", "reframe", "hold", "loop"] },
    capability_profile: {
      type: "object",
      additionalProperties: false,
      required: ["hero", "continuity_critical", "complex_motion", "requires_audio_reference", "requires_video_reference"],
      properties: {
        hero: { type: "boolean" },
        continuity_critical: { type: "boolean" },
        complex_motion: { type: "boolean" },
        requires_audio_reference: { type: "boolean" },
        requires_video_reference: { type: "boolean" },
      },
    },
  },
} as const;

const CONCEPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "premise", "story", "visual_language", "camera_language", "recurring_motif",
    "world", "character_strategy", "beginning", "middle", "ending", "musical_fit", "complexity",
    "anti_cliches", "signature_moments",
  ],
  properties: {
    title: { type: "string" }, premise: { type: "string" }, story: { type: "string" }, visual_language: { type: "string" },
    camera_language: { type: "string" }, recurring_motif: { type: "string" }, world: { type: "string" }, character_strategy: { type: "string" },
    beginning: { type: "string" }, middle: { type: "string" }, ending: { type: "string" }, musical_fit: { type: "string" },
    complexity: { type: "string", enum: ["low", "medium", "high"] }, anti_cliches: { type: "array", items: { type: "string" } },
    signature_moments: { type: "array", items: { type: "object", additionalProperties: false, required: ["time_ms", "description"], properties: { time_ms: { type: "integer", minimum: 0 }, description: { type: "string" } } } },
  },
} as const;

const VISUAL_BIBLE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["world", "palette", "materials", "camera_rules", "lighting_rules", "texture_rules", "continuity_rules", "recurring_motifs", "avoid"],
  properties: {
    world: { type: "string" }, palette: { type: "array", items: { type: "string" } }, materials: { type: "array", items: { type: "string" } },
    camera_rules: { type: "array", items: { type: "string" } }, lighting_rules: { type: "array", items: { type: "string" } },
    texture_rules: { type: "array", items: { type: "string" } }, continuity_rules: { type: "array", items: { type: "string" } },
    recurring_motifs: { type: "array", items: { type: "string" } }, avoid: { type: "array", items: { type: "string" } },
  },
} as const;

function compactContext(context: VideoProjectContext) {
  const brief = parseVideoCreativeBrief(context.project.creative_brief);
  return {
    project: { title: context.project.title, target: context.project.project_kind, aspect_ratio: context.project.primary_aspect_ratio, resolution: context.project.target_resolution, hard_budget_credits: context.project.hard_budget_credits, brief },
    track: { title: context.track.title, duration_seconds: context.track.duration, notes: context.track.notes },
    release: { title: context.release.title, story: context.release.story, core_emotion: context.release.core_emotion, audience: context.release.audience, primary_hook: context.release.primary_hook, visual_direction: context.release.visual_direction, color_palette: context.release.color_palette, release_identity: context.release.release_identity, story_answers: context.release.story_answers },
    music_map: context.musicMap,
    lyrics_intelligence: conciseLyricsPromptContext(context.lyrics),
    brand_settings: context.brandSettings,
    available_media: context.media.map((asset) => ({ id: asset.id, type: asset.asset_type, mime: asset.mime_type, metadata: asset.metadata, has_url: Boolean(asset.public_url) })),
    learned_preferences: context.preferences,
  };
}

const DIRECTOR_INSTRUCTIONS = `You are the creative director for Atlas Irwin, an electronic music artist. Design music videos as coherent films, not a montage of AI demo shots.

Creative requirements:
- Build one memorable visual system or premise that can evolve across the whole track.
- Respond to the actual music map, section changes, peaks, breakdowns and edit points.
- Treat Lyrics Intelligence as song-specific narrative evidence: use its themes, imagery, emotional arc and timed Lyric Moments to shape visual causality, concepts and edit payoffs. Do not default to literal lyric illustration.
- When a Lyric Moment has timing, combine that timing with the music map and stem-aware Audio Scenes so lyrical meaning and musical payoff reinforce one another.
- Only quote lyric text that the supplied Lyrics Intelligence explicitly marks as mayQuote=true. Never invent, complete, reconstruct or paraphrase text as if it were an official lyric.
- Prefer tactile, physical-looking materials, purposeful camera language and visual causality.
- Avoid generic cyberpunk, purple neon cities, random nightclub crowds, generic fashion models, floating particles, meaningless abstract blobs, literal audio visualizers and disconnected pretty shots unless the supplied context explicitly asks for them.
- Reuse worlds, motifs, props and visual grammar for continuity.
- Design for production efficiency. A full track should normally need roughly 12-18 unique generated source sequences, not a new expensive generation every few seconds. Use editorial reuse, continuation, holds, loops and reframes deliberately.
- Human subjects are optional and must respect people_mode.
- Prompts must describe a shot that a video model can execute: subject, environment, action, camera, light, material behavior, continuity anchors. Do not include prose about feelings that has no visible manifestation.
- Compose hero material so useful 9:16 social reframes are possible whenever it does not hurt the 16:9 master. Mark vertical_safe only when a vertical crop can preserve the essential subject/action, and set vertical_focus to the subject's horizontal position.
- The first timeline shot must create its own source with reuse_strategy=unique. Later editorial reuse may only refer backward to an established source.
- test_shot_indexes must refer only to unique or continuation source shots that can actually be generated and reviewed.
- The final result must feel intentional, premium, strange enough to be memorable, and recognizably part of one Atlas Irwin world.`;

async function structuredResponse<T>({
  context,
  task,
  purpose,
  schema,
  instructions,
  prompt,
  qualityGate,
}: {
  context: VideoProjectContext;
  task: AtlasAiTaskType;
  purpose: string;
  schema: Record<string, unknown>;
  instructions: string;
  prompt: string;
  qualityGate: AtlasQualityGate<T>;
}): Promise<T> {
  const result = await runAtlasAiTask<T>({
    ownerId: context.project.owner_id,
    task,
    purpose,
    releaseId: context.release.id,
    videoProjectId: context.project.id,
    promptVersion: "video-director-v2",
    schema,
    instructions,
    input: prompt,
    inputContext: compactContext(context),
    qualityGate,
    timeoutMs: 180_000,
  });
  return result.value;
}

function conceptQualityGate(context: VideoProjectContext): AtlasQualityGate<{ concepts: VideoConcept[] }> {
  const durationMs = context.musicMap?.duration_ms || Math.round((context.track.duration ?? 0) * 1000);
  return ({ concepts }) => {
    const titles = concepts.map((concept) => concept.title.trim().toLowerCase());
    const premises = concepts.map((concept) => concept.premise.trim().toLowerCase());
    const richConcepts = concepts.every((concept) =>
      concept.premise.trim().length >= 30 &&
      concept.story.trim().length >= 60 &&
      concept.visual_language.trim().length >= 25 &&
      concept.camera_language.trim().length >= 15 &&
      concept.recurring_motif.trim().length >= 8 &&
      concept.anti_cliches.length >= 2 &&
      concept.signature_moments.length >= 2,
    );
    const timingsValid = concepts.every((concept) => concept.signature_moments.every((moment) =>
      moment.time_ms >= 0 && (durationMs <= 0 || moment.time_ms <= durationMs),
    ));
    return strictQualityResult([
      { passed: concepts.length === 3, failure: "Creative Director must return exactly three concepts." },
      { passed: new Set(titles).size === concepts.length, failure: "Video concepts are not distinct enough by title." },
      { passed: new Set(premises).size === concepts.length, failure: "Video concepts repeat the same premise." },
      { passed: richConcepts, failure: "One or more concepts are too thin to review as a real creative treatment." },
      { passed: timingsValid, failure: "A signature moment falls outside the track timeline." },
    ]);
  };
}

function planQualityGate(context: VideoProjectContext): AtlasQualityGate<ProductionPlan> {
  return (plan) => {
    const failures: string[] = [];
    try { validatePlanTimeline(plan, context); }
    catch (error) { failures.push(error instanceof Error ? error.message : "Storyboard timeline validation failed."); }
    const shots = plan.scenes.flatMap((scene) => scene.shots);
    const paidSources = shots.filter((shot) => shot.reuse_strategy === "unique" || shot.reuse_strategy === "continuation").length;
    const hasUsefulBible = plan.visual_bible.world.trim().length >= 20
      && plan.visual_bible.camera_rules.length >= 2
      && plan.visual_bible.continuity_rules.length >= 2
      && plan.visual_bible.avoid.length >= 2;
    const promptsExecutable = shots.every((shot) => shot.prompt.trim().length >= 35 && shot.description.trim().length >= 10);
    return strictQualityResult([
      { passed: failures.length === 0, failure: failures.join("; ") || "Storyboard timeline is invalid." },
      { passed: plan.look_dev_prompts.length >= 3 && plan.look_dev_prompts.length <= 10, failure: "Production plan needs 3-10 useful look-development prompts." },
      { passed: hasUsefulBible, failure: "Visual bible is too thin to preserve continuity." },
      { passed: promptsExecutable, failure: "One or more storyboard prompts are not executable enough for a video model." },
      { passed: paidSources > 0, failure: "Production plan contains no source shots that can actually be generated." },
    ]);
  };
}

function shotQualityGate(): AtlasQualityGate<StoryboardShot> {
  return (shot) => strictQualityResult([
    { passed: shot.end_ms > shot.start_ms, failure: "Revised shot has an invalid duration." },
    { passed: shot.description.trim().length >= 10, failure: "Revised shot description is too thin." },
    { passed: shot.prompt.trim().length >= 35, failure: "Revised shot prompt is not executable enough." },
    { passed: ["left", "center", "right"].includes(shot.vertical_focus), failure: "Revised shot is missing a valid vertical focus." },
  ]);
}

export class OpenAIMusicVideoDirector implements MusicVideoCreativeDirector {
  async createConcepts(context: VideoProjectContext): Promise<VideoConcept[]> {
    const result = await structuredResponse<{ concepts: VideoConcept[] }>({
      context,
      task: "video.concepts",
      purpose: "video_concepts",
      instructions: DIRECTOR_INSTRUCTIONS,
      prompt: `Create exactly three materially different music-video concepts. They must differ in premise and visual mechanism, not merely color palette. Context:\n${JSON.stringify(compactContext(context))}`,
      schema: { type: "object", additionalProperties: false, required: ["concepts"], properties: { concepts: { type: "array", minItems: 3, maxItems: 3, items: CONCEPT_SCHEMA } } },
      qualityGate: conceptQualityGate(context),
    });
    return result.concepts;
  }

  async createProductionPlan(context: VideoProjectContext, concept: VideoConcept): Promise<ProductionPlan> {
    const result = await structuredResponse<ProductionPlan>({
      context,
      task: "video.production_plan",
      purpose: "video_production_plan",
      instructions: `${DIRECTOR_INSTRUCTIONS}\nBuild a timeline with no gaps or overlaps that covers the full target duration. Keep individual generated source sequences practical for current video models, usually 4-15 seconds. Shots may reuse a generated source editorially; mark that with reuse_strategy. Reserve quality priority for hero moments rather than every shot.`,
      prompt: `Turn the approved concept into a visual bible and production-ready storyboard. Approved concept:\n${JSON.stringify(concept)}\n\nProject context:\n${JSON.stringify(compactContext(context))}`,
      schema: { type: "object", additionalProperties: false, required: ["visual_bible", "scenes", "look_dev_prompts", "test_shot_indexes", "editing_strategy", "reuse_strategy", "production_notes"], properties: {
        visual_bible: VISUAL_BIBLE_SCHEMA,
        scenes: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["title", "start_ms", "end_ms", "description", "visual_intent", "shots"], properties: { title: { type: "string" }, start_ms: { type: "integer", minimum: 0 }, end_ms: { type: "integer", minimum: 1 }, description: { type: "string" }, visual_intent: { type: "string" }, shots: { type: "array", minItems: 1, items: SHOT_SCHEMA } } } },
        look_dev_prompts: { type: "array", minItems: 3, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["label", "prompt", "purpose"], properties: { label: { type: "string" }, prompt: { type: "string" }, purpose: { type: "string" } } } },
        test_shot_indexes: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 }, maxItems: 4 }, editing_strategy: { type: "string" }, reuse_strategy: { type: "string" }, production_notes: { type: "array", items: { type: "string" } },
      } },
      qualityGate: planQualityGate(context),
    });
    validatePlanTimeline(result, context);
    return result;
  }

  async reviseShot(input: { context: VideoProjectContext; concept: VideoConcept; visualBible: VisualBible; currentShot: StoryboardShotRevisionInput; instruction: string }): Promise<StoryboardShot> {
    return structuredResponse<StoryboardShot>({
      context: input.context,
      task: "video.shot_revision",
      purpose: "video_shot_revision",
      instructions: `${DIRECTOR_INSTRUCTIONS}\nRevise only the requested shot. Preserve its exact start_ms and end_ms unless the instruction explicitly requires a timing change. Preserve continuity with the visual bible. Always return explicit vertical_safe and vertical_focus values.`,
      prompt: JSON.stringify({ instruction: input.instruction, current_shot: input.currentShot, visual_bible: input.visualBible, approved_concept: input.concept, project: compactContext(input.context) }),
      schema: SHOT_SCHEMA,
      qualityGate: shotQualityGate(),
    });
  }
}

function validatePlanTimeline(plan: ProductionPlan, context: VideoProjectContext) {
  const durationMs = context.musicMap?.duration_ms || Math.round((context.track.duration ?? 0) * 1000);
  const shots = plan.scenes.flatMap((scene) => scene.shots);
  if (!shots.length) throw new Error("Creative Director returned an empty storyboard.");
  if (shots[0].reuse_strategy !== "unique") throw new Error("Creative Director first shot must create a unique source.");

  const boundaryToleranceMs = 50;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    if (shot.end_ms <= shot.start_ms) throw new Error(`Creative Director returned an invalid duration for shot ${index + 1}.`);
    if (index > 0) {
      const delta = shot.start_ms - shots[index - 1].end_ms;
      if (Math.abs(delta) > boundaryToleranceMs) {
        throw new Error(`Creative Director storyboard has a ${delta > 0 ? "gap" : "overlap"} before shot ${index + 1}. Regenerate the plan.`);
      }
    }
  }

  if (durationMs > 0) {
    if (shots[0].start_ms > boundaryToleranceMs || Math.abs(shots.at(-1)!.end_ms - durationMs) > boundaryToleranceMs) {
      throw new Error("Creative Director storyboard does not cover the full track duration closely enough. Regenerate the plan.");
    }
    if (shots.some((shot) => shot.start_ms > durationMs + boundaryToleranceMs || shot.end_ms > durationMs + boundaryToleranceMs)) {
      throw new Error("Creative Director storyboard extends beyond the track duration.");
    }
  }

  const testIndexes = plan.test_shot_indexes;
  if (!testIndexes.length || new Set(testIndexes).size !== testIndexes.length) {
    throw new Error("Creative Director must return unique representative test-shot indexes.");
  }
  for (const index of testIndexes) {
    const shot = shots[index];
    if (!shot) throw new Error(`Creative Director test shot index ${index} is outside the storyboard.`);
    if (!["unique", "continuation"].includes(shot.reuse_strategy)) {
      throw new Error(`Creative Director test shot ${index + 1} is editorial-only and cannot be generated as a representative test.`);
    }
  }
}