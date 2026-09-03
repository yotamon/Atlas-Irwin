"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import type { MarketingMetricSnapshot } from "@/types/marketing-database";

const required = z.string().trim().min(1).max(300);
const text = z.string().trim().max(10000);
const number = z.coerce.number().int().nonnegative().default(0);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}

async function analyticsContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id") || null;
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, z.uuid().parse(requestedArtistId))
    : await resolveDefaultArtistContext(supabase, user);
  return { supabase, artist };
}

export async function saveMetric(form: FormData) {
  const { supabase, artist } = await analyticsContext(form);
  const marketing = asMarketingClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const releaseId = nullable(form, "release_id");
  const contentItemId = nullable(form, "content_item_id");
  if (releaseId) {
    const { data, error } = await music.from("releases").select("id")
      .eq("id", z.uuid().parse(releaseId)).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Release does not belong to the active artist.");
  }
  if (contentItemId) {
    const { data, error } = await marketing.from("content_items").select("id")
      .eq("id", z.uuid().parse(contentItemId)).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Content item does not belong to the active artist.");
  }

  const numeric = ["reach","views","watch_time","likes","comments","shares","saves","profile_visits","follows","link_clicks","streams","listeners","playlist_adds"] as const;
  const row: Partial<MarketingMetricSnapshot> = {
    owner_id: artist.userId,
    artist_id: artist.artistId,
    date: required.parse(value(form, "date")),
    platform: required.parse(value(form, "platform")),
    release_id: releaseId,
    content_item_id: contentItemId,
    notes: nullable(form, "notes"),
    source: "manual",
    captured_at: new Date().toISOString(),
  };
  numeric.forEach((key) => { row[key] = number.parse(value(form, key) || "0"); });
  const id = value(form, "id");
  const mutation = id
    ? marketing.from("metric_snapshots").update(row).eq("id", z.uuid().parse(id)).eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
    : marketing.from("metric_snapshots").insert(row);
  const { error } = await mutation;
  if (error) throw new Error(error.message);
  revalidatePath("/studio/analytics");
  revalidatePath("/studio/learn");
}

export async function saveLearning(form: FormData) {
  const { supabase, artist } = await analyticsContext(form);
  const music = asArtistScopedMusicClient(supabase);
  const operational = asArtistScopedOperationalClient(supabase);
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const { data: release, error: releaseError } = await music.from("releases").select("id")
    .eq("id", releaseId).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) throw new Error("Release does not belong to the active artist.");
  const { error } = await operational.from("release_learnings").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    release_id: releaseId,
    learning: text.min(3).parse(value(form, "learning")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/studio/analytics");
}

export async function deleteStudioRecord(form: FormData) {
  const { supabase, artist } = await analyticsContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const table = z.enum(["metric_snapshots", "release_learnings"]).parse(value(form, "table"));
  const client = table === "metric_snapshots"
    ? asMarketingClient(supabase).from("metric_snapshots")
    : asArtistScopedOperationalClient(supabase).from("release_learnings");
  const { error } = await client.delete().eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/analytics");
  revalidatePath("/studio/learn");
}
