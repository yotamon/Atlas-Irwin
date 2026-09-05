"use server";

import { z } from "zod";
import { saveContentV2 } from "@/app/studio/content-actions-v2";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { artistMemoryBrief, loadArtistMemoryForConsumer } from "@/lib/artist-memory/server";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { resolveCreateOutcome } from "@/lib/studio/create-outcomes";
import { asMomentsClient } from "@/lib/studio/moments-db";

const uuid = z.uuid();

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function startOutcomeCreative(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artistId = uuid.parse(value(form, "artist_id"));
  const artist = await resolveArtistContext(supabase, user, artistId);
  const momentId = uuid.parse(value(form, "moment_id"));
  const outcome = resolveCreateOutcome(value(form, "outcome"));
  if (!outcome) throw new Error("Choose a valid creative outcome.");

  const moments = asMomentsClient(supabase);
  const [{ data: moment, error }, memory] = await Promise.all([
    moments
      .from("moments")
      .select("id,release_id,label,start_ms,end_ms,state")
      .eq("id", momentId)
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .maybeSingle(),
    loadArtistMemoryForConsumer({
      db: supabase,
      ownerId: artist.userId,
      artistId: artist.artistId,
      consumer: "creative_direction",
    }),
  ]);
  if (error) throw new Error(error.message);
  if (!moment) throw new Error("Moment not found for the active artist.");
  if (moment.state !== "approved") throw new Error("Only an approved Moment can start creative execution.");

  const rememberedDirection = artistMemoryBrief(memory.items, 1_800);
  const notes = [
    `Creative outcome: ${outcome.label}. ${outcome.description}`,
    rememberedDirection
      ? `Bounded Artist Memory (${memory.maxEffect.replaceAll("_", " ")}):\n${rememberedDirection}`
      : null,
  ].filter(Boolean).join("\n\n");

  const production = new FormData();
  production.set("artist_id", artist.artistId);
  production.set("release_id", moment.release_id);
  production.set("moment_id", moment.id);
  production.set("title", `${moment.label} · ${outcome.titleSuffix}`);
  production.set("platform", outcome.platform);
  production.set("format", outcome.format);
  production.set("goal", outcome.goal);
  production.set("audio_timestamp_start", String(Math.floor(moment.start_ms / 1000)));
  production.set("audio_timestamp_end", String(Math.ceil(moment.end_ms / 1000)));
  production.set("production_notes", notes);

  await saveContentV2(production);
}
