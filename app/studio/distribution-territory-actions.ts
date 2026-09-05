"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";
import type { DistributionDatabase, ReleaseDistributionConfig } from "@/types/distribution-database";

const EDITABLE_STATES = new Set(["draft", "needs_attention", "ready", "rejected", "error"]);

type Db = SupabaseClient<DistributionDatabase>;

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function parseCountries(raw: string) {
  const countries = [...new Set(raw.split(/[\s,;]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const invalid = countries.find((country) => !/^[A-Z]{2}$/.test(country));
  if (invalid) throw new Error(`Territory '${invalid}' must be a two-letter ISO country code.`);
  return countries;
}

export async function saveDistributionTerritories(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!releaseId) throw new Error("Release is required.");
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = text(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as Db;

  const [releaseResult, configResult] = await Promise.all([
    db.from("releases").select("id").eq("id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
  ]);
  if (releaseResult.error) throw new Error(releaseResult.error.message);
  if (!releaseResult.data) throw new Error("Release not found for the active artist.");
  if (configResult.error) throw new Error(configResult.error.message);
  const previous = configResult.data as ReleaseDistributionConfig | null;
  if (previous && !EDITABLE_STATES.has(previous.state)) throw new Error("Territories are locked after distribution submission. Start a correction workflow first.");

  const mode = text(form, "territory_mode") === "include" ? "include" as const : "worldwide" as const;
  const countries = mode === "include" ? parseCountries(text(form, "territory_codes")) : [];
  if (mode === "include" && !countries.length) throw new Error("Enter at least one two-letter country code, or choose worldwide.");
  const territoryState = { mode, countries };
  const previousRights = object(previous?.rights);
  const rights = {
    ...previousRights,
    territories: mode === "worldwide" ? "worldwide" : countries,
  };

  const save = await db.from("release_distribution_configs").upsert({
    release_id: releaseId,
    owner_id: user.id,
    artist_id: artist.artistId,
    provider: previous?.provider ?? "revelator",
    provider_release_id: previous?.provider_release_id ?? null,
    state: previous ? "draft" : "draft",
    destinations: previous?.destinations ?? json({ mode: "all_enabled", storeIds: [] }),
    territories: json(territoryState),
    rights: json(rights),
    ai_provenance: previous?.ai_provenance ?? {},
    provider_metadata: previous?.provider_metadata ?? {},
    readiness_score: 0,
    last_validated_at: null,
  }, { onConflict: "release_id" });
  if (save.error) throw new Error(save.error.message);

  const event = await db.from("distribution_events").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    release_id: releaseId,
    submission_id: null,
    event_type: "distribution.territories_saved",
    actor_type: "artist",
    provider: previous?.provider ?? "revelator",
    payload: json(territoryState),
  });
  if (event.error) throw new Error(event.error.message);

  redirect(`/studio/releases/${encodeURIComponent(releaseId)}/distribution?notice=${encodeURIComponent(mode === "worldwide" ? "Distribution territory set to worldwide." : `Distribution limited to ${countries.join(", ")}.`)}`);
}
