"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildArtistStrategy } from "@/lib/artist-operating/strategy";
import { loadArtistOperatingContext } from "@/lib/artist-operating/server";
import { sceneRelationshipOpportunityKind } from "@/lib/artist-operating/scene-intelligence";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Database, Json } from "@/types/database";
import type { EnsemblisDatabase } from "@/types/ensemblis-database";
import type { SupabaseClient } from "@supabase/supabase-js";

const involvementSchema = z.enum(["hands_on", "guided", "just_make_music"]);
const careerSchema = z.enum(["starting", "emerging", "active", "established"]);
const goalSchema = z.enum(["get_heard", "release_music", "get_gigs", "grow_fans", "find_labels", "build_owned_audience"]);
const visibilitySchema = z.enum(["face_forward", "selective", "music_first", "anonymous"]);
const cadenceSchema = z.enum(["frequent", "steady", "occasional"]);
const disclosureSchema = z.enum(["required_only", "always"]);
const contentComfortSchema = z.enum(["camera", "live", "studio", "photos", "artwork", "graphics"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function list(form: FormData, key: string) {
  return String(form.get(key) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function controlledBoolean(form: FormData, key: string, fallback: boolean) {
  return form.has(`${key}_control`) ? form.get(key) === "on" : fallback;
}

function moneyCents(form: FormData, fallback: number) {
  if (!form.has("monthly_budget")) return fallback;
  const parsed = Number.parseFloat(value(form, "monthly_budget") || "0");
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : fallback;
}

function json(value: unknown) {
  return value as Json;
}

function asEnsemblisClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<EnsemblisDatabase>;
}

async function persistStrategy(
  client: SupabaseClient<Database>,
  artist: Awaited<ReturnType<typeof resolveActiveArtistContext>>,
) {
  const db = asEnsemblisClient(client);
  const context = await loadArtistOperatingContext({ db: client, artist });
  const strategy = buildArtistStrategy(context);
  const now = new Date().toISOString();
  const { error: supersedeError } = await db
    .from("artist_strategy_snapshots")
    .update({ status: "superseded", superseded_at: now })
    .eq("artist_id", artist.artistId)
    .eq("status", "active");
  if (supersedeError) throw new Error(supersedeError.message);
  const { error } = await db.from("artist_strategy_snapshots").insert({
    artist_id: artist.artistId,
    status: "active",
    strategy: json(strategy),
    source_context: json({
      project_type: context.artist.projectType,
      profile_configured: context.profileConfigured,
      primary_goal: context.profile.primaryGoal,
      scene_confidence: context.scene.confidence,
      relationship_ids: context.relationships.map((relationship) => relationship.id),
      generated_at: now,
    }),
  });
  if (error) throw new Error(error.message);
  return { context, strategy };
}

async function syncSceneGrowthOpportunities(
  client: SupabaseClient<Database>,
  ownerId: string,
  artist: Awaited<ReturnType<typeof resolveActiveArtistContext>>,
) {
  const context = await loadArtistOperatingContext({ db: client, artist });
  const growth = asGrowthClient(client);

  const rows = context.relationships.map((relationship) => ({
    owner_id: ownerId,
    artist_id: artist.artistId,
    kind: sceneRelationshipOpportunityKind(relationship.type),
    title: `${relationship.targetName} may fit ${context.artist.name}`,
    rationale: `This ${relationship.type.replaceAll("_", " ")} relationship is backed by stored scene evidence. Review the fit before any outreach or external action.`,
    priority: relationship.fitScore,
    confidence: relationship.confidence,
    evidence: json({ scene_relationship_id: relationship.id, ...relationship.evidence }),
    recommended_action: json({ type: "review_scene_relationship", relationship_id: relationship.id, href: "/studio/growth/strategy" }),
    dedupe_key: `artist:${artist.artistId}:scene:${relationship.id}`,
    status: "new" as const,
  }));

  if (!rows.length && context.scene.primaryScene) {
    rows.push({
      owner_id: ownerId,
      artist_id: artist.artistId,
      kind: "scene_fit",
      title: `Map the ${context.scene.primaryScene} ecosystem`,
      rationale: "The artist has explicitly identified this scene, but Ensemblis does not yet have enough evidence to name labels, playlists, channels, promoters or festivals. Research should happen before outreach.",
      priority: 65,
      confidence: Math.max(0.5, context.scene.confidence),
      evidence: json({ source: "artist_scene_profile", scene: context.scene.primaryScene, evidence: context.scene.evidence }),
      recommended_action: json({ type: "research_scene", href: "/studio/growth/strategy" }),
      dedupe_key: `artist:${artist.artistId}:scene-map:${context.scene.primaryScene.toLowerCase()}`,
      status: "new" as const,
    });
  }

  for (const row of rows) {
    const { data: existing, error: lookupError } = await growth
      .from("growth_opportunities")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("artist_id", artist.artistId)
      .eq("dedupe_key", row.dedupe_key)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      const { error } = await growth
        .from("growth_opportunities")
        .update(row)
        .eq("id", existing.id)
        .eq("owner_id", ownerId)
        .eq("artist_id", artist.artistId);
      if (error) throw new Error(error.message);
      continue;
    }

    const { error } = await growth.from("growth_opportunities").insert(row);
    if (error) throw new Error(error.message);
  }
}

export async function saveArtistOperatingProfileAction(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const current = await loadArtistOperatingContext({ db: supabase, artist });
  const db = asEnsemblisClient(supabase);

  const marketingInvolvement = involvementSchema.parse(value(form, "marketing_involvement") || current.profile.marketingInvolvement);
  const careerStage = careerSchema.parse(value(form, "career_stage") || current.profile.careerStage);
  const primaryGoal = goalSchema.parse(value(form, "primary_goal") || current.profile.primaryGoal);
  const visibilityMode = visibilitySchema.parse(value(form, "visibility_mode") || current.profile.visibilityMode);
  const releaseCadence = cadenceSchema.parse(value(form, "release_cadence") || current.profile.releaseCadence);
  const disclosurePreference = disclosureSchema.parse(value(form, "disclosure_preference") || current.profile.aiPolicy.disclosurePreference);
  const contentComfort = form.has("content_comfort_present")
    ? form.getAll("content_comfort").map(String).map((item) => contentComfortSchema.parse(item))
    : current.profile.contentComfort;
  const currency = (value(form, "currency") || current.profile.currency || "EUR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid workspace currency.");

  const { error: profileError } = await db.from("artist_operating_profiles").upsert({
    artist_id: artist.artistId,
    marketing_involvement: marketingInvolvement,
    career_stage: careerStage,
    primary_goal: primaryGoal,
    visibility_mode: visibilityMode,
    content_comfort: contentComfort,
    release_cadence: releaseCadence,
    monthly_budget_cents: moneyCents(form, current.profile.monthlyBudgetCents),
    currency,
    ai_writing_allowed: controlledBoolean(form, "ai_writing_allowed", current.profile.aiPolicy.writingAllowed),
    ai_visuals_allowed: controlledBoolean(form, "ai_visuals_allowed", current.profile.aiPolicy.visualsAllowed),
    ai_music_allowed: controlledBoolean(form, "ai_music_allowed", current.profile.aiPolicy.musicAllowed),
    ai_voice_allowed: controlledBoolean(form, "ai_voice_allowed", current.profile.aiPolicy.voiceAllowed),
    ai_likeness_allowed: controlledBoolean(form, "ai_likeness_allowed", current.profile.aiPolicy.likenessAllowed),
    disclosure_preference: disclosurePreference,
  }, { onConflict: "artist_id" });
  if (profileError) throw new Error(profileError.message);

  const { error: pauseError } = await db.from("artist_goals").update({ status: "paused" }).eq("artist_id", artist.artistId).eq("status", "active").neq("kind", primaryGoal);
  if (pauseError) throw new Error(pauseError.message);
  const { error: goalError } = await db.from("artist_goals").upsert({ artist_id: artist.artistId, kind: primaryGoal, priority: 100, status: "active" }, { onConflict: "artist_id,kind" });
  if (goalError) throw new Error(goalError.message);

  if (form.has("scene_profile_present")) {
    const primaryScene = value(form, "primary_scene").slice(0, 120) || null;
    const subScenes = list(form, "sub_scenes");
    const geographicAffinities = list(form, "geographic_affinities");
    const now = new Date().toISOString();
    const { error: sceneError } = await db.from("artist_scene_profiles").upsert({
      artist_id: artist.artistId,
      primary_scene: primaryScene,
      sub_scenes: subScenes,
      geographic_affinities: geographicAffinities,
      evidence: json(primaryScene || subScenes.length || geographicAffinities.length ? { source: "artist_explicit", captured_at: now } : {}),
      confidence: primaryScene ? 1 : 0,
    }, { onConflict: "artist_id" });
    if (sceneError) throw new Error(sceneError.message);
  }

  await persistStrategy(supabase, artist);
  await syncSceneGrowthOpportunities(supabase, user.id, artist);
  revalidatePath("/studio");
  revalidatePath("/studio/onboarding");
  revalidatePath("/studio/settings");
  revalidatePath("/studio/settings/artist");
  revalidatePath("/studio/create");
  revalidatePath("/studio/growth");
  revalidatePath("/studio/growth/strategy");
}

export async function refreshArtistStrategyAction() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  await persistStrategy(supabase, artist);
  await syncSceneGrowthOpportunities(supabase, user.id, artist);
  revalidatePath("/studio");
  revalidatePath("/studio/growth");
  revalidatePath("/studio/growth/strategy");
}
