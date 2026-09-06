import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultArtistOperatingProfile, type ArtistOperatingContext, type ArtistStrategy } from "@/lib/artist-operating/domain";
import { usableSceneRelationships } from "@/lib/artist-operating/scene-intelligence";
import { loadWorkspaceOperatingPreferences } from "@/lib/studio/operating-preferences";
import type { ArtistContext } from "@/lib/studio/artist-context";
import type { Database, Json } from "@/types/database";
import type {
  Artist,
  ArtistGoalRow,
  ArtistOperatingProfileRow,
  ArtistSceneProfileRow,
  ArtistSceneRelationshipRow,
  ArtistStrategySnapshotRow,
  EnsemblisDatabase,
} from "@/types/ensemblis-database";

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: Json | null | undefined): unknown[] {
  return Array.isArray(value) ? value : [];
}

function schemaMissing(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("artist_operating_profiles") ||
    normalized.includes("artist_scene_profiles") ||
    normalized.includes("artist_scene_relationships") ||
    normalized.includes("artist_strategy_snapshots") ||
    (normalized.includes("schema cache") && normalized.includes("artist_"));
}

function strategyFromJson(value: Json | null | undefined): ArtistStrategy | null {
  const raw = object(value);
  if (typeof raw.positioning !== "string" || typeof raw.growthFocus !== "string") return null;
  return raw as unknown as ArtistStrategy;
}

export async function loadArtistOperatingContext({
  db: client,
  artist,
}: {
  db: SupabaseClient<Database>;
  artist: ArtistContext;
}): Promise<ArtistOperatingContext> {
  const db = client as unknown as SupabaseClient<EnsemblisDatabase>;
  const artistResult = await db
    .from("artists")
    .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,legacy_owner_id,created_at,updated_at")
    .eq("id", artist.artistId)
    .maybeSingle();
  if (artistResult.error) throw new Error(artistResult.error.message);
  if (!artistResult.data) throw new Error("Artist operating context could not resolve the active artist.");
  const artistRow = artistResult.data as Artist;
  const preferences = await loadWorkspaceOperatingPreferences(client, artist.workspaceId);

  const [profileResult, goalsResult, sceneResult, relationshipResult, strategyResult] = await Promise.all([
    db.from("artist_operating_profiles").select("*").eq("artist_id", artist.artistId).maybeSingle(),
    db.from("artist_goals").select("*").eq("artist_id", artist.artistId).eq("status", "active").order("priority", { ascending: false }),
    db.from("artist_scene_profiles").select("*").eq("artist_id", artist.artistId).maybeSingle(),
    db.from("artist_scene_relationships").select("*").eq("artist_id", artist.artistId).neq("status", "dismissed").order("fit_score", { ascending: false }),
    db.from("artist_strategy_snapshots").select("*").eq("artist_id", artist.artistId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const results = [profileResult, goalsResult, sceneResult, relationshipResult, strategyResult];
  const blockingError = results.map((result) => result.error).find((error) => error && !schemaMissing(error.message));
  if (blockingError) throw new Error(blockingError.message);
  const schemaReady = !results.some((result) => result.error && schemaMissing(result.error.message));

  const storedProfile = schemaReady ? profileResult.data as ArtistOperatingProfileRow | null : null;
  const fallback = defaultArtistOperatingProfile(artistRow.project_type, preferences.currency);
  const profile = storedProfile ? {
    marketingInvolvement: storedProfile.marketing_involvement,
    careerStage: storedProfile.career_stage,
    primaryGoal: storedProfile.primary_goal,
    visibilityMode: storedProfile.visibility_mode,
    contentComfort: storedProfile.content_comfort,
    releaseCadence: storedProfile.release_cadence,
    monthlyBudgetCents: storedProfile.monthly_budget_cents,
    currency: storedProfile.currency,
    aiPolicy: {
      writingAllowed: storedProfile.ai_writing_allowed,
      visualsAllowed: storedProfile.ai_visuals_allowed,
      musicAllowed: storedProfile.ai_music_allowed,
      voiceAllowed: storedProfile.ai_voice_allowed,
      likenessAllowed: storedProfile.ai_likeness_allowed,
      disclosurePreference: storedProfile.disclosure_preference,
    },
  } : fallback;

  const sceneRow = schemaReady ? sceneResult.data as ArtistSceneProfileRow | null : null;
  const scene = sceneRow ? {
    primaryScene: sceneRow.primary_scene,
    subScenes: sceneRow.sub_scenes,
    geographicAffinities: sceneRow.geographic_affinities,
    audienceHypotheses: array(sceneRow.audience_hypotheses),
    evidence: object(sceneRow.evidence),
    confidence: Number(sceneRow.confidence),
  } : {
    primaryScene: null,
    subScenes: [],
    geographicAffinities: [],
    audienceHypotheses: [],
    evidence: {},
    confidence: 0,
  };

  const relationships = usableSceneRelationships(((schemaReady ? relationshipResult.data : []) ?? []).map((row) => {
    const relationship = row as ArtistSceneRelationshipRow;
    return {
      id: relationship.id,
      type: relationship.relationship_type,
      targetName: relationship.target_name,
      targetUrl: relationship.target_url,
      fitScore: Number(relationship.fit_score),
      confidence: Number(relationship.confidence),
      evidence: object(relationship.evidence),
      status: relationship.status === "dismissed" ? "candidate" : relationship.status,
      observedAt: relationship.observed_at,
      expiresAt: relationship.expires_at,
    };
  }));

  const goals = ((schemaReady ? goalsResult.data : []) ?? []).map((row) => {
    const goal = row as ArtistGoalRow;
    return { kind: goal.kind, priority: Number(goal.priority), status: goal.status };
  });
  const snapshot = schemaReady ? strategyResult.data as ArtistStrategySnapshotRow | null : null;

  return {
    artist: { id: artistRow.id, name: artistRow.name, projectType: artistRow.project_type },
    profileConfigured: Boolean(storedProfile),
    profile,
    goals,
    scene,
    relationships,
    strategySnapshot: strategyFromJson(snapshot?.strategy),
  };
}
