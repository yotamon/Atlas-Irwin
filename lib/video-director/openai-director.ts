import "server-only";

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

type ResponsePayload = { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>; error?: { message?: string } };

function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Creative Director is not configured. Set OPENAI_API_KEY.");
  return key;
}

function directorModel() {
  const model = process.env.VIDEO_DIRECTOR_LLM_MODEL?.trim();
  if (!model) {
    throw new Error(
      "Creative Director model is not configured. Set VIDEO_DIRECTOR_LLM_MODEL to a Responses API model available to this OpenAI account.",
    );
  }
  return model;
}

function outputText(payload: ResponsePayload) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) for (const content of item.content ?? []) { if (content.type === "refusal" && content.refusal) throw new Error(`Creative Director refused: ${content.refusal}`); if (content.text) return content.text; }
  throw new Error(payload.error?.message || "Creative Director returned no structured output.");
}

async function structuredResponse<T>(input: { name: string; schema: Record<string, unknown>; instructions: string; prompt: string }): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: directorModel(), store: false, instructions: input.instructions, input: input.prompt, text: { verbosity: "medium", format: { type: "json_schema", name: input.name, strict: true, schema: input.schema } } }),
  });
  const payload = await response.json().catch(() => ({})) as ResponsePayload;
  if (!response.ok) throw new Error(payload.error?.message || `Creative Director failed (${response.status}).`);
  try { return JSON.parse(outputText(payload)) as T; } catch (error) { throw new Error(`Creative Director returned invalid structured JSON: ${error instanceof Error ? error.message : "unknown parse error"}`); }
}

function compactContext(context: VideoProjectContext) {
  const brief = parseVideoCreativeBrief(context.project.creative_brief);
  return {
    project: { title: context.project.title, target: context.project.project_kind, aspect_ratio: context.project.primary_aspect_ratio, resolution: context.project.target_resolution, hard_budget_credits: context.project.hard_budget_credits, brief },
    track: { title: context.track.title, duration_seconds: context.track.duration, notes: context.track.notes },
    release: { title: context.release.title, story: context.release.story, core_emotion: context.release.core_emotion, audience: context.release.audience, primary_hook: context.release.primary_hook, visual_direction: context.release.visual_direction, color_palette: context.release.color_palette, release_identity: context.release.release_identity, story_answers: context.release.story_answers },
    music_map: context.musicMap,
    brand_settings: context.brandSettings,
    available_media: context.media.map((asset) => ({ id: asset.id, type: asset.asset_type, mime: asset.mime_type, metadata: asset.metadata, has_url: Boolean(asset.public_url) })),
    learned_preferences: context.preferences,
  };
}

const DIRECTOR_INSTRUCTIONS = `You are the creative director for Atlas Irwin, an electronic music artist. Design music videos as coherent films, not a montage of AI demo shots.

Creative requirements:
- Build one memorable visual system or premise that can evolve across the whole track.
- Respond to the actual music map, section changes, peaks, breakdowns and edit points.
- Prefer tactile, physical-looking materials, purposeful camera language and visual causality.
- Avoid generic cyberpunk, purple neon cities, random nightclub crowds, generic fashion models, floating particles, meaningless abstract blobs, literal audio visualizers and disconnected pretty shots unless the supplied context explicitly asks for them.
- Reuse worlds, motifs, props and visual grammar for continuity.
- Design for production efficiency. A full track should normally need roughly 12-18 unique generated source sequences, not a new expensive generation every few seconds. Use editorial reuse, continuation, holds, loops and reframes deliberately.
- Human subjects are optional and must respect people_mode.
- Prompts must describe a shot that a video model can execute: subject, environment, action, camera, light, material behavior, continuity anchors. Do not include prose about feelings that has no visible manifestation.
- Compose hero material so useful 9:16 social reframes are possible whenever it does not hurt the 16:9 master. Mark vertical_safe only when a vertical crop can preserve the essential subject/action, and set vertical_focus to the subject's horizontal position.
- The final result must feel intentional, premium, strange enough to be memorable, and recognizably part of one Atlas Irwin world.`;

export class OpenAIMusicVideoDirector implements MusicVideoCreativeDirector {
  async createConcepts(context: VideoProjectContext): Promise<VideoConcept[]> {
    const result = await structuredResponse<{ concepts: VideoConcept[] }>({ name: "atlas_video_concepts", instructions: DIRECTOR_INSTRUCTIONS, prompt: `Create exactly three materially different music-video concepts. They must differ in premise and visual mechanism, not merely color palette. Context:\n${JSON.stringify(compactContext(context))}`, schema: { type: "object", additionalProperties: false, required: ["concepts"], properties: { concepts: { type: "array", minItems: 3, maxItems: 3, items: CONCEPT_SCHEMA } } } });
    return result.concepts;
  }

  async createProductionPlan(context: VideoProjectContext, concept: VideoConcept): Promise<ProductionPlan> {
    const result = await structuredResponse<ProductionPlan>({
      name: "atlas_video_production_plan",
      instructions: `${DIRECTOR_INSTRUCTIONS}\nBuild a timeline with no gaps or overlaps that covers the full target duration. Keep individual generated source sequences practical for current video models, usually 4-15 seconds. Shots may reuse a generated source editorially; mark that with reuse_strategy. Reserve quality priority for hero moments rather than every shot.`,
      prompt: `Turn the approved concept into a visual bible and production-ready storyboard. Approved concept:\n${JSON.stringify(concept)}\n\nProject context:\n${JSON.stringify(compactContext(context))}`,
      schema: { type: "object", additionalProperties: false, required: ["visual_bible", "scenes", "look_dev_prompts", "test_shot_indexes", "editing_strategy", "reuse_strategy", "production_notes"], properties: {
        visual_bible: VISUAL_BIBLE_SCHEMA,
        scenes: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["title", "start_ms", "end_ms", "description", "visual_intent", "shots"], properties: { title: { type: "string" }, start_ms: { type: "integer", minimum: 0 }, end_ms: { type: "integer", minimum: 1 }, description: { type: "string" }, visual_intent: { type: "string" }, shots: { type: "array", minItems: 1, items: SHOT_SCHEMA } } } },
        look_dev_prompts: { type: "array", minItems: 3, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["label", "prompt", "purpose"], properties: { label: { type: "string" }, prompt: { type: "string" }, purpose: { type: "string" } } } },
        test_shot_indexes: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 }, maxItems: 4 }, editing_strategy: { type: "string" }, reuse_strategy: { type: "string" }, production_notes: { type: "array", items: { type: "string" } },
      } },
    });
    validatePlanTimeline(result, context);
    return result;
  }

  async reviseShot(input: { context: VideoProjectContext; concept: VideoConcept; visualBible: VisualBible; currentShot: StoryboardShotRevisionInput; instruction: string }): Promise<StoryboardShot> {
    return structuredResponse<StoryboardShot>({ name: "atlas_video_shot_revision", instructions: `${DIRECTOR_INSTRUCTIONS}\nRevise only the requested shot. Preserve its exact start_ms and end_ms unless the instruction explicitly requires a timing change. Preserve continuity with the visual bible. Always return explicit vertical_safe and vertical_focus values.`, prompt: JSON.stringify({ instruction: input.instruction, current_shot: input.currentShot, visual_bible: input.visualBible, approved_concept: input.concept, project: compactContext(input.context) }), schema: SHOT_SCHEMA });
  }
}

function validatePlanTimeline(plan: ProductionPlan, context: VideoProjectContext) {
  const durationMs = context.musicMap?.duration_ms || Math.round((context.track.duration ?? 0) * 1000);
  const shots = plan.scenes.flatMap((scene) => scene.shots).sort((a, b) => a.start_ms - b.start_ms);
  if (!shots.length) throw new Error("Creative Director returned an empty storyboard.");
  for (const shot of shots) if (shot.end_ms <= shot.start_ms) throw new Error("Creative Director returned an invalid shot duration.");
  if (durationMs > 0) { const tolerance = 1500; if (shots[0].start_ms > tolerance || Math.abs(shots.at(-1)!.end_ms - durationMs) > tolerance) throw new Error("Creative Director storyboard does not cover the track duration closely enough. Regenerate the plan."); }
}

export function openAIDirectorReadiness() {
  const model = process.env.VIDEO_DIRECTOR_LLM_MODEL?.trim() || "";
  return {
    configured: Boolean(process.env.OPENAI_API_KEY?.trim() && model),
    model: model || "Not configured",
  };
}
