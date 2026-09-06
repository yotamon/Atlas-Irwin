import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { defaultArtistOperatingProfile } from "./domain";
import type { EnsemblisDatabase } from "@/types/ensemblis-database";

export type ArtistAiCapability = "writing" | "visuals" | "music" | "voice" | "likeness";

export class ArtistAiCapabilityDisabledError extends Error {
  readonly artistId: string;
  readonly capability: ArtistAiCapability;

  constructor(input: { artistId: string; artistName: string; capability: ArtistAiCapability }) {
    const label = input.capability === "visuals" ? "generative visuals" : input.capability === "music" ? "AI music generation" : input.capability === "voice" ? "synthetic voice" : input.capability === "likeness" ? "synthetic artist likeness" : "AI writing";
    super(`${label} is disabled for ${input.artistName}. Enable it explicitly in Artist Profile before using this capability.`);
    this.name = "ArtistAiCapabilityDisabledError";
    this.artistId = input.artistId;
    this.capability = input.capability;
  }
}

function capabilityValue(
  capability: ArtistAiCapability,
  policy: ReturnType<typeof defaultArtistOperatingProfile>["aiPolicy"],
) {
  if (capability === "writing") return policy.writingAllowed;
  if (capability === "visuals") return policy.visualsAllowed;
  if (capability === "music") return policy.musicAllowed;
  if (capability === "voice") return policy.voiceAllowed;
  return policy.likenessAllowed;
}

function operatingPolicySchemaUnavailable(message: string) {
  const value = message.toLowerCase();
  return value.includes("artist_operating_profiles")
    || value.includes("ai_music_allowed")
    || (value.includes("schema cache") && value.includes("operating"));
}

export async function assertArtistAiCapability(input: {
  artistId: string;
  capability: ArtistAiCapability;
}) {
  const db = createServiceClient() as unknown as SupabaseClient<EnsemblisDatabase>;
  const [{ data: artist, error: artistError }, profileResult] = await Promise.all([
    db.from("artists").select("id,name,project_type").eq("id", input.artistId).maybeSingle(),
    db.from("artist_operating_profiles").select("ai_writing_allowed,ai_visuals_allowed,ai_music_allowed,ai_voice_allowed,ai_likeness_allowed").eq("artist_id", input.artistId).maybeSingle(),
  ]);
  if (artistError) throw new Error(artistError.message);
  if (!artist) throw new Error("Artist not found while checking AI capability policy.");
  if (profileResult.error && !operatingPolicySchemaUnavailable(profileResult.error.message)) {
    throw new Error(profileResult.error.message);
  }

  const defaults = defaultArtistOperatingProfile(artist.project_type).aiPolicy;
  const profile = profileResult.error ? null : profileResult.data;
  const policy = profile ? {
    writingAllowed: profile.ai_writing_allowed,
    visualsAllowed: profile.ai_visuals_allowed,
    musicAllowed: profile.ai_music_allowed,
    voiceAllowed: profile.ai_voice_allowed,
    likenessAllowed: profile.ai_likeness_allowed,
    disclosurePreference: defaults.disclosurePreference,
  } : defaults;

  if (!capabilityValue(input.capability, policy)) {
    throw new ArtistAiCapabilityDisabledError({
      artistId: artist.id,
      artistName: artist.name,
      capability: input.capability,
    });
  }
  return policy;
}
