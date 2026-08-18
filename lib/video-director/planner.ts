import "server-only";

import type { Json } from "@/types/database";
import type { ExtendedMusicVideoProject, ExtendedMusicVideoShot, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HiggsfieldProvider } from "@/lib/video-providers/higgsfield/client";
import { routeLookDevelopmentModel, routeVideoShot } from "./model-router";
import type { ProductionPlan, VideoConcept, VideoProjectContext } from "./creative-director";

function json(value: unknown): Json {
  return value as Json;
}

export async function persistConceptRound(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
  concepts: VideoConcept[];
}) {
  const { data: rounds, error: roundError } = await input.db.from("music_video_concepts")
    .select("round_number")
    .eq("project_id", input.project.id)
    .eq("owner_id", input.ownerId)
    .order("round_number", { ascending: false })
    .limit(1);
  if (roundError) throw new Error(roundError.message);
  const round = (rounds?.[0]?.round_number ?? 0) + 1;
  await input.db.from("music_video_concepts")
    .update({ status: "superseded" })
    .eq("project_id", input.project.id)
    .eq("owner_id", input.ownerId)
    .eq("status", "draft");
  const { data, error } = await input.db.from("music_video_concepts").insert(
    input.concepts.map((concept, index) => ({
      owner_id: input.ownerId,
      project_id: input.project.id,
      round_number: round,
      display_order: index,
      title: concept.title,
      premise: concept.premise,
      concept_data: json(concept),
      treatment: null,
      status: "draft" as const,
    })),
  ).select("*").order("display_order");
  if (error) throw new Error(error.message);
  await input.db.from("music_video_projects").update({
    creative_generated_at: new Date().toISOString(),
    last_error: null,
    status: "concept_review",
  }).eq("id", input.project.id).eq("owner_id", input.ownerId);
  return data ?? [];
}

function shotMusicContext(context: VideoProjectContext, startMs: number, endMs: number) {
  const midpoint = (startMs + endMs) / 2;
  const section = context.musicMap?.sections.find((item) => midpoint >= item.start_ms && midpoint < item.end_ms) ?? null;
  const energyValue = section?.energy ?? 0.5;
  return {
    section_id: section?.id ?? null,
    section_label: section?.label ?? "Unknown",
    section_type: section?.type ?? "unknown",
    energy_value: energyValue,
    energy: energyValue >= 0.82 ? "peak" : energyValue <= 0.38 ? "low" : "mid",
    near_edit_point: Boolean(context.musicMap?.edit_points.some((point) => Math.abs(point.ms - startMs) <= 700)),
  };
}

function durationForGeneration(shotDurationSeconds: number, model: string) {
  const minimum = model === "kling3_0" ? 3 : 4;
  const maximum = model === "seedance_2_5" ? 30 : 15;
  return Math.max(minimum, Math.min(maximum, Math.ceil(shotDurationSeconds)));
}

function requiresPaidSource(strategy: ExtendedMusicVideoShot["reuse_strategy"]) {
  return strategy === "unique" || strategy === "continuation";
}

export async function persistProductionPlan(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  context: VideoProjectContext & { project: ExtendedMusicVideoProject };
  plan: ProductionPlan;
}) {
  const provider = new HiggsfieldProvider();
  const flattened = input.plan.scenes.flatMap((scene, sceneIndex) =>
    scene.shots.map((shot, shotIndex) => ({ scene, sceneIndex, shot, shotIndex })),
  );
  const shotRows: Array<{
    sceneIndex: number;
    data: Omit<Partial<ExtendedMusicVideoShot>, "scene_id"> & { display_order: number; start_ms: number; end_ms: number; description: string };
    quoteCredits: number;
    reserveCredits: number;
  }> = [];
  let sourceGenerationCredits = 0;
  let sourceReserveCredits = 0;

  for (let index = 0; index < flattened.length; index += 1) {
    const entry = flattened[index];
    const musicContext = shotMusicContext(input.context, entry.shot.start_ms, entry.shot.end_ms);
    const provisional = {
      generation_priority: entry.shot.generation_priority,
      capability_profile: entry.shot.capability_profile,
      start_asset_id: null,
      end_asset_id: null,
      reference_asset_ids: [],
      music_context: musicContext,
    } as const;
    const testIndexes = new Set(input.plan.test_shot_indexes);
    const routing = routeVideoShot({
      ...provisional,
      targetResolution: input.context.project.target_resolution,
      isTest: testIndexes.has(index),
    });
    const seconds = Math.max(0.1, (entry.shot.end_ms - entry.shot.start_ms) / 1000);
    const generationSeconds = durationForGeneration(seconds, routing.model);
    const quote = requiresPaidSource(entry.shot.reuse_strategy)
      ? await provider.quote({
          operation: testIndexes.has(index) ? "test_video" : "shot_video",
          model: routing.model,
          prompt: entry.shot.prompt,
          negativePrompt: entry.shot.negative_prompt,
          durationSeconds: generationSeconds,
          aspectRatio: input.context.project.primary_aspect_ratio,
          resolution: input.context.project.target_resolution,
          params: routing.params,
        })
      : { credits: 0, reserveCredits: 0 };
    sourceGenerationCredits += quote.credits;
    sourceReserveCredits += quote.reserveCredits;
    shotRows.push({
      sceneIndex: entry.sceneIndex,
      quoteCredits: quote.credits,
      reserveCredits: quote.reserveCredits,
      data: {
        owner_id: input.ownerId,
        project_id: input.context.project.id,
        display_order: index,
        start_ms: entry.shot.start_ms,
        end_ms: entry.shot.end_ms,
        description: entry.shot.description,
        prompt: entry.shot.prompt,
        negative_prompt: entry.shot.negative_prompt,
        capability_profile: json(entry.shot.capability_profile),
        selected_provider: "higgsfield",
        selected_model: routing.model,
        generation_params: json({ ...routing.params, duration: generationSeconds, routing_reason: routing.reason }),
        reference_asset_ids: [],
        reuse_strategy: entry.shot.reuse_strategy,
        generation_priority: entry.shot.generation_priority,
        review_note: null,
        music_context: json(musicContext),
        prompt_version: 1,
        status: "ready_for_reference",
      },
    });
  }

  const lookModel = routeLookDevelopmentModel();
  let lookCredits = 0;
  let lookReserveCredits = 0;
  for (const prompt of input.plan.look_dev_prompts) {
    const quote = await provider.quote({
      operation: "look_image",
      model: lookModel.id,
      prompt: prompt.prompt,
      aspectRatio: input.context.project.primary_aspect_ratio,
      resolution: input.context.project.target_resolution,
    });
    lookCredits += quote.credits;
    lookReserveCredits += quote.reserveCredits;
  }

  const costEstimate = {
    source_generation_credits: Number(sourceGenerationCredits.toFixed(2)),
    source_reserve_credits: Number(sourceReserveCredits.toFixed(2)),
    look_dev_credits: Number(lookCredits.toFixed(2)),
    look_dev_reserve_credits: Number(lookReserveCredits.toFixed(2)),
    total_credits: Number((sourceGenerationCredits + lookCredits).toFixed(2)),
    total_reserve_credits: Number((sourceReserveCredits + lookReserveCredits).toFixed(2)),
    unique_source_sequences: shotRows.filter((row) => requiresPaidSource(row.data.reuse_strategy ?? "unique")).length,
    editorial_reuse_shots: shotRows.filter((row) => !requiresPaidSource(row.data.reuse_strategy ?? "unique")).length,
    look_dev_frames: input.plan.look_dev_prompts.length,
    quote_note: "Planning estimate. Every paid batch is rechecked against an approval envelope and the project hard cap before submission.",
  };
  const storedPlan = { ...input.plan, cost_estimate: costEstimate };

  const { error: clearShotsError } = await input.db.from("music_video_shots").delete()
    .eq("project_id", input.context.project.id).eq("owner_id", input.ownerId);
  if (clearShotsError) throw new Error(clearShotsError.message);
  const { error: clearScenesError } = await input.db.from("music_video_scenes").delete()
    .eq("project_id", input.context.project.id).eq("owner_id", input.ownerId);
  if (clearScenesError) throw new Error(clearScenesError.message);

  const sceneIds: string[] = [];
  for (let index = 0; index < input.plan.scenes.length; index += 1) {
    const scene = input.plan.scenes[index];
    const { data, error } = await input.db.from("music_video_scenes").insert({
      owner_id: input.ownerId,
      project_id: input.context.project.id,
      display_order: index,
      start_ms: scene.start_ms,
      end_ms: scene.end_ms,
      title: scene.title,
      description: scene.description,
      visual_intent: json({ description: scene.visual_intent }),
    }).select("id").single();
    if (error || !data) throw new Error(error?.message || "Could not save storyboard scene.");
    sceneIds.push(data.id);
  }

  const insertedShotIds: string[] = [];
  for (const row of shotRows) {
    const previousId = insertedShotIds.at(-1) ?? null;
    const strategy = row.data.reuse_strategy ?? "unique";
    const { data, error } = await input.db.from("music_video_shots").insert({
      ...row.data,
      scene_id: sceneIds[row.sceneIndex],
      continuity_from_shot_id: strategy === "unique" ? null : previousId,
    }).select("id").single();
    if (error || !data) throw new Error(error?.message || "Could not save storyboard shot.");
    insertedShotIds.push(data.id);
  }

  const { error: projectError } = await input.db.from("music_video_projects").update({
    visual_bible: json(input.plan.visual_bible),
    production_plan: json(storedPlan),
    estimated_credits: costEstimate.total_credits,
    status: "production_plan_review",
    last_error: null,
  }).eq("id", input.context.project.id).eq("owner_id", input.ownerId);
  if (projectError) throw new Error(projectError.message);
  return { plan: storedPlan, costEstimate, shotIds: insertedShotIds };
}

export function conceptFromRow(value: Json): VideoConcept {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored concept is invalid.");
  return value as unknown as VideoConcept;
}
