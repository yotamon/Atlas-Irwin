import "server-only";

import { generateGatewayVisionStructured } from "@/lib/ai/gateway-vision";
import { getAiBudgetSnapshot, loadAiControlSettings } from "@/lib/ai/control-plane";
import { parseGatewayModelList } from "@/lib/ai/gateway";
import { createServiceClient } from "@/lib/supabase/service";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export type VideoDirectorQualityReview = {
  version: "video-director-quality-v1";
  passed: boolean;
  publishReady: boolean;
  score: number;
  verdict: "approve" | "regenerate" | "manual_review";
  summary: string;
  scores: {
    temporalConsistency: number;
    artifactIntegrity: number;
    identityContinuity: number;
    captionIntegrity: number;
    editorialCoherence: number;
    professionalFinish: number;
    genericAiRisk: number;
  };
  issues: Array<{ code: string; severity: "blocking" | "warning"; detail: string }>;
  regenerateGuidance: string;
  humanAttestationsValid: boolean;
  lipSyncAutomatedVerdict: "not_assessed_from_sparse_frames";
  model: string;
};

type ModelReview = Omit<VideoDirectorQualityReview,
  "version" | "passed" | "publishReady" | "humanAttestationsValid" | "lipSyncAutomatedVerdict" | "model"
>;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict", "summary", "scores", "issues", "regenerateGuidance"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["approve", "regenerate", "manual_review"] },
    summary: { type: "string", minLength: 10, maxLength: 800 },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["temporalConsistency", "artifactIntegrity", "identityContinuity", "captionIntegrity", "editorialCoherence", "professionalFinish", "genericAiRisk"],
      properties: {
        temporalConsistency: { type: "number", minimum: 0, maximum: 100 },
        artifactIntegrity: { type: "number", minimum: 0, maximum: 100 },
        identityContinuity: { type: "number", minimum: 0, maximum: 100 },
        captionIntegrity: { type: "number", minimum: 0, maximum: 100 },
        editorialCoherence: { type: "number", minimum: 0, maximum: 100 },
        professionalFinish: { type: "number", minimum: 0, maximum: 100 },
        genericAiRisk: { type: "number", minimum: 0, maximum: 100 },
      },
    },
    issues: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "detail"],
        properties: {
          code: { type: "string", minLength: 2, maxLength: 90 },
          severity: { type: "string", enum: ["blocking", "warning"] },
          detail: { type: "string", minLength: 4, maxLength: 480 },
        },
      },
    },
    regenerateGuidance: { type: "string", maxLength: 900 },
  },
} satisfies Record<string, unknown>;

const REVIEW_INSTRUCTIONS = `You are Ensemblis' senior music-video finishing and continuity reviewer.
The FIRST images are chronological frames sampled from the FINAL assembled music-video render. Any remaining images are approved character/reference images for the active artist.

Judge only evidence visible in these frames. Be strict about:
- identity drift across frames or against supplied character references;
- malformed faces, hands, bodies, props, architecture or impossible geometry;
- objects, wardrobe, materials, lighting or spatial logic changing without editorial intent;
- generated pseudo-text, accidental logos, watermarks or UI contamination;
- deterministic captions being clipped, illegible, duplicated, malformed or visually inconsistent;
- composition and visual hierarchy feeling amateur or generically AI-generated;
- the sequence lacking a coherent editorial progression or visual relationship to the supplied visual bible.

Do NOT claim to verify phoneme-level lip-sync from sparse still frames. Lip-sync is explicitly human-attested elsewhere. If mouth positions look obviously implausible you may flag a warning, but never mark lip-sync as automatically passed.
Use manual_review when frame evidence is genuinely ambiguous instead of inventing certainty.`;

function normalized(value: number) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

async function assertBudget(ownerId: string) {
  const settings = await loadAiControlSettings(ownerId);
  if (!settings.hard_stop) return settings;
  const budget = await getAiBudgetSnapshot(ownerId, settings);
  if (budget.monthlyRemainingUsd <= 0 || budget.textRemainingUsd <= 0) {
    throw new Error("Ensemblis AI reasoning budget is exhausted, so final music-video temporal QC cannot run.");
  }
  return settings;
}

export async function reviewVideoDirectorRender(input: {
  ownerId: string;
  projectId: string;
  renderId: string;
  frames: Array<{ timestampMs: number; url: string }>;
}) : Promise<VideoDirectorQualityReview> {
  if (input.frames.length < 3) throw new Error("Final music-video temporal QC requires at least three chronological frames.");
  const service = createServiceClient();
  const db = service as unknown as SupabaseClient<VideoDatabase>;
  const { data: project, error: projectError } = await db.from("music_video_projects").select("*")
    .eq("id", input.projectId).eq("owner_id", input.ownerId).single();
  if (projectError || !project) throw new Error(projectError?.message || "Video project not found for final QC.");
  const musicDb = service as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
  const { data: release, error: releaseError } = await musicDb.from("releases").select("artist_id,title,release_identity")
    .eq("id", project.release_id).eq("owner_id", input.ownerId).single();
  if (releaseError || !release?.artist_id) throw new Error(releaseError?.message || "Video QC cannot resolve artist lineage.");

  const { data: shots, error: shotsError } = await db.from("music_video_shots").select("*")
    .eq("project_id", project.id).eq("owner_id", input.ownerId).order("display_order");
  if (shotsError) throw new Error(shotsError.message);
  const characterIds = [...new Set((shots ?? []).flatMap((shot) => shot.character_id ? [shot.character_id] : []))];
  const { data: characters, error: charactersError } = characterIds.length
    ? await db.from("music_video_characters").select("id,name,identity_prompt,reference_asset_ids,approved_asset_ids,continuity_notes")
      .eq("owner_id", input.ownerId).eq("artist_id", release.artist_id).in("id", characterIds)
    : { data: [], error: null };
  if (charactersError) throw new Error(charactersError.message);
  const referenceIds = [...new Set((characters ?? []).flatMap((character) => [
    ...strings(character.approved_asset_ids),
    ...strings(character.reference_asset_ids),
  ]))].slice(0, 8);
  const { data: referenceAssets, error: assetsError } = referenceIds.length
    ? await db.from("media_assets").select("id,public_url").eq("owner_id", input.ownerId).in("id", referenceIds)
    : { data: [], error: null };
  if (assetsError) throw new Error(assetsError.message);
  const referenceUrls = referenceIds.flatMap((id) => {
    const asset = (referenceAssets ?? []).find((item) => item.id === id);
    return asset?.public_url ? [asset.public_url] : [];
  });

  const humanAttestationsValid = (shots ?? []).every((shot) => {
    const performance = record(shot.performance_config);
    const requiresLipSync = shot.shot_type === "performance" && performance.lip_sync === true;
    const requiresContinuity = Boolean(shot.character_id);
    if (!requiresLipSync && !requiresContinuity) return true;
    const quality = record(shot.quality_checks);
    return Boolean(
      shot.selected_asset_id
      && quality.review_asset_id === shot.selected_asset_id
      && (!requiresLipSync || quality.lip_sync_approved === true)
      && (!requiresContinuity || quality.continuity_approved === true)
    );
  });

  const settings = await assertBudget(input.ownerId);
  const model = process.env.ENSEMBLIS_CREATIVE_REVIEW_MODEL?.trim()
    || process.env.ATLAS_CREATIVE_REVIEW_MODEL?.trim()
    || "openai/gpt-5.6-terra";
  const fallbackModels = parseGatewayModelList(
    process.env.ENSEMBLIS_CREATIVE_REVIEW_FALLBACK_MODELS
      || process.env.ATLAS_CREATIVE_REVIEW_FALLBACK_MODELS,
  );
  const chronological = [...input.frames].sort((a, b) => a.timestampMs - b.timestampMs).slice(0, 6);
  const remaining = Math.max(0, 10 - chronological.length);
  const refs = referenceUrls.slice(0, remaining);
  const result = await generateGatewayVisionStructured<ModelReview>({
    name: "video_director_final_quality",
    schema: REVIEW_SCHEMA,
    instructions: REVIEW_INSTRUCTIONS,
    prompt: JSON.stringify({
      task: "Review the final assembled music video against its visual bible, editorial intent and approved character identities.",
      projectId: project.id,
      renderId: input.renderId,
      frameOrder: chronological.map((frame, index) => ({ imageIndex: index + 1, timestampMs: frame.timestampMs })),
      characterReferenceStartIndex: chronological.length + 1,
      release: { title: release.title, releaseIdentity: release.release_identity },
      visualBible: project.visual_bible,
      creativeBrief: project.creative_brief,
      characters: (characters ?? []).map((character) => ({
        name: character.name,
        identityPrompt: character.identity_prompt,
        continuityNotes: character.continuity_notes,
      })),
      shotPlan: (shots ?? []).map((shot) => ({
        index: shot.display_order + 1,
        type: shot.shot_type,
        description: shot.description,
        characterId: shot.character_id,
        captions: shot.lyrics_config,
        humanQuality: shot.quality_checks,
      })),
      lipSyncPolicy: "Sparse frames cannot prove phoneme sync. Do not auto-pass lip-sync.",
    }),
    imageUrls: [...chronological.map((frame) => frame.url), ...refs],
    model,
    fallbackModels,
    providerSort: settings.provider_sort,
    timeoutMs: 150_000,
  });
  const review = result.value;
  const blocking = review.issues.some((issue) => issue.severity === "blocking");
  const score = normalized(review.score);
  const scores = review.scores;
  const passed = !blocking
    && review.verdict === "approve"
    && score >= 86
    && normalized(scores.temporalConsistency) >= 84
    && normalized(scores.artifactIntegrity) >= 88
    && normalized(scores.identityContinuity) >= 82
    && normalized(scores.captionIntegrity) >= 82
    && normalized(scores.editorialCoherence) >= 78
    && normalized(scores.professionalFinish) >= 84
    && normalized(scores.genericAiRisk) <= 26;
  return {
    version: "video-director-quality-v1",
    ...review,
    score,
    passed,
    publishReady: passed && humanAttestationsValid,
    humanAttestationsValid,
    lipSyncAutomatedVerdict: "not_assessed_from_sparse_frames",
    model: result.model,
  };
}
