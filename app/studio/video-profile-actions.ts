"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import { routeVideoShot } from "@/lib/video-director/model-router";
import { buildProductionProfilePreview } from "@/lib/video-director/profile-preview";
import {
  VIDEO_PRODUCTION_PROFILES,
  parseVideoProductionPreferences,
} from "@/lib/video-director/production-profile";
import type { Json } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function json(input: unknown): Json {
  return input as Json;
}

const profileSchema = z.enum(VIDEO_PRODUCTION_PROFILES);
const maxBudgetUsdSchema = z.preprocess(
  (raw) => typeof raw === "string" && raw.trim() === "" ? null : raw,
  z.coerce.number().finite().min(1).max(100000).nullable(),
);

const PROFILE_EDITABLE_STATUSES = new Set([
  "draft",
  "analyzing_audio",
  "concept_review",
  "treatment_review",
  "production_plan_review",
  "look_dev",
  "look_review",
]);

function testShotIndexes(productionPlan: unknown) {
  const plan = record(productionPlan);
  const raw = plan.test_shot_indexes;
  return new Set(Array.isArray(raw) ? raw.filter((item): item is number => Number.isInteger(item)) : []);
}

export async function updateVideoProductionProfile(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const profile = profileSchema.parse(value(form, "production_profile"));
  const maxBudgetUsd = maxBudgetUsdSchema.parse(value(form, "max_budget_usd"));

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = createServiceClient();
  const context = await loadVideoProjectContext(db, projectId, user.id, artist.artistId);
  const project = context.project;
  if (project.status === "archived") throw new Error("Archived video projects are read only.");

  const current = parseVideoProductionPreferences(project.creative_brief);
  if (profile !== current.profile && !PROFILE_EDITABLE_STATUSES.has(project.status)) {
    throw new Error("The global production profile is locked after motion generation begins. Change individual future shots instead so completed spend stays auditable.");
  }

  const currentBrief = record(project.creative_brief);
  const storedBaseCap = typeof currentBrief.provider_credit_safety_cap === "number"
    ? currentBrief.provider_credit_safety_cap
    : Number(project.hard_budget_credits);
  const baseProviderCap = Math.max(storedBaseCap, Number(project.spent_credits) + Number(project.reserved_credits));
  const usdPerCredit = Number(process.env.HIGGSFIELD_USD_PER_CREDIT);
  const hasUsdRate = Number.isFinite(usdPerCredit) && usdPerCredit > 0;
  const committedCredits = Number(project.spent_credits) + Number(project.reserved_credits);

  let effectiveProviderCap = baseProviderCap;
  if (maxBudgetUsd !== null) {
    if (!hasUsdRate) {
      if (committedCredits > 0) {
        throw new Error("A USD max spend cannot be changed after spend exists until HIGGSFIELD_USD_PER_CREDIT is configured, because Ensemblis cannot guarantee the ceiling without a trusted conversion rate.");
      }
      effectiveProviderCap = 0;
    } else {
      const committedUsd = committedCredits * usdPerCredit;
      if (maxBudgetUsd + 0.0001 < committedUsd) {
        throw new Error(`The max spend cannot be lower than the $${committedUsd.toFixed(2)} already spent or reserved.`);
      }
      effectiveProviderCap = Math.min(baseProviderCap, maxBudgetUsd / usdPerCredit);
    }
  }

  const creativeBrief = {
    ...currentBrief,
    production_profile: profile,
    max_budget_usd: maxBudgetUsd,
    provider_credit_safety_cap: baseProviderCap,
  };

  const { data: shots, error: shotsError } = await db.from("music_video_shots")
    .select("*")
    .eq("owner_id", user.id)
    .eq("project_id", projectId)
    .order("display_order");
  if (shotsError) throw new Error(shotsError.message);

  const preview = await buildProductionProfilePreview({
    project,
    shots: shots ?? [],
    profile,
  });
  const byShot = new Map(preview.shots.map((item) => [item.shotId, item]));
  const tests = testShotIndexes(project.production_plan);

  if (profile !== current.profile && (shots ?? []).length) {
    for (const shot of shots ?? []) {
      const planned = byShot.get(shot.id);
      if (!planned || shot.status === "locked") continue;
      const routing = routeVideoShot({
        generation_priority: shot.generation_priority,
        capability_profile: shot.capability_profile,
        start_asset_id: shot.start_asset_id,
        end_asset_id: shot.end_asset_id,
        reference_asset_ids: shot.reference_asset_ids,
        music_context: shot.music_context,
        targetResolution: project.target_resolution,
        isTest: tests.has(shot.display_order),
        productionProfile: profile,
      });
      const params = record(shot.generation_params);
      const { error } = await db.from("music_video_shots").update({
        selected_provider: routing.provider,
        selected_model: routing.model,
        generation_params: json({
          ...params,
          ...routing.params,
          duration: planned.generationSeconds,
          routing_reason: routing.reason,
          routing_profile: profile,
          routing_model_label: routing.modelLabel,
          routing_provider_label: routing.providerLabel,
          routing_alternatives: routing.alternatives,
        }),
      }).eq("id", shot.id).eq("owner_id", user.id);
      if (error) throw new Error(error.message);
    }
  }

  const plan = record(project.production_plan);
  const oldCost = record(plan.cost_estimate);
  const videoExpected = preview.shots.reduce((sum, shot) => sum + shot.expectedCredits, 0);
  const videoReserve = preview.shots.reduce((sum, shot) => sum + shot.reserveCredits, 0);
  const lookExpected = typeof oldCost.look_dev_credits === "number" ? oldCost.look_dev_credits : 0;
  const lookReserve = typeof oldCost.look_dev_reserve_credits === "number" ? oldCost.look_dev_reserve_credits : 0;
  const nextCost = {
    ...oldCost,
    production_profile: profile,
    source_generation_credits: Number(videoExpected.toFixed(2)),
    source_reserve_credits: Number(videoReserve.toFixed(2)),
    total_credits: Number((videoExpected + lookExpected).toFixed(2)),
    total_reserve_credits: Number((videoReserve + lookReserve).toFixed(2)),
  };

  const projectUpdate = {
    creative_brief: json(creativeBrief),
    hard_budget_credits: Number(effectiveProviderCap.toFixed(2)),
    estimated_credits: nextCost.total_credits,
    ...(Object.keys(plan).length ? { production_plan: json({ ...plan, cost_estimate: nextCost }) } : {}),
  };

  const { error: projectError } = await db.from("music_video_projects")
    .update(projectUpdate)
    .eq("id", projectId)
    .eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);

  revalidatePath(`/studio/video/${projectId}`);
  revalidatePath(`/studio/releases/${project.release_id}`);
}
