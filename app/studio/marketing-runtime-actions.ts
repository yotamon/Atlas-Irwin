"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { runMarketingAutomationCycle } from "@/lib/marketing/automation";
import { asMarketingClient } from "@/lib/marketing/db";
import { processDueOutreachEnrollments } from "@/lib/marketing/outreach";
import { processDuePublicationJobs } from "@/lib/marketing/publications";
import {
  resolveArtistContext,
  resolveDefaultArtistContext,
  type ArtistContext,
} from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function optionalUuid(form: FormData, key: string) {
  const raw = value(form, key);
  return raw ? z.uuid().parse(raw) : null;
}

function numeric(form: FormData, key: string) {
  return Math.max(0, Math.round(Number(value(form, key)) || 0));
}

async function runtimeContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = optionalUuid(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  return { supabase, user, artist };
}

async function assertScopedId(
  marketing: ReturnType<typeof asMarketingClient>,
  artist: ArtistContext,
  table: "campaigns" | "content_items" | "content_variants" | "campaign_experiments",
  id: string | null,
) {
  if (!id) return;
  const { data, error } = await marketing
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${table} item does not belong to the active artist.`);
}

export async function runMarketingAutomationNow(form: FormData) {
  const { supabase, artist } = await runtimeContext(form);
  const marketing = asMarketingClient(supabase);
  const campaignId = optionalUuid(form, "campaign_id");
  await assertScopedId(marketing, artist, "campaigns", campaignId);

  const scope = { ownerId: artist.userId, artistId: artist.artistId };
  await processDuePublicationJobs(20, scope);
  await processDueOutreachEnrollments(25, scope);
  await runMarketingAutomationCycle(artist.artistId);

  revalidatePath("/studio/campaigns");
  revalidatePath("/studio/analytics");
  revalidatePath("/studio/content");
  revalidatePath("/studio/outreach");
  if (campaignId) revalidatePath(`/studio/campaigns/${campaignId}`);
}

export async function markPublicationPublished(form: FormData) {
  const { supabase, artist } = await runtimeContext(form);
  const marketing = asMarketingClient(supabase);
  const jobId = z.uuid().parse(value(form, "job_id"));
  const { data: job, error: jobError } = await marketing
    .from("publication_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .single();
  if (jobError) throw new Error(jobError.message);
  if (!(job.status === "manual_ready" as never || job.status === "approved" || job.status === "scheduled")) {
    throw new Error("This publication is not ready to be marked as published.");
  }

  const publishedAt = new Date().toISOString();
  const { error } = await marketing.from("publication_jobs").update({
    status: "published",
    published_at: publishedAt,
    external_post_id: value(form, "external_post_id") || null,
    external_url: value(form, "external_url") || null,
    last_error: null,
  })
    .eq("id", jobId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);

  if (job.content_variant_id) {
    const { error: variantError } = await marketing.from("content_variants")
      .update({ status: "published", published_at: publishedAt })
      .eq("id", job.content_variant_id)
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId);
    if (variantError) throw new Error(variantError.message);
  }
  if (job.content_item_id) {
    const { error: contentError } = await marketing.from("content_items")
      .update({ status: "Published", published_at: publishedAt })
      .eq("id", job.content_item_id)
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId);
    if (contentError) throw new Error(contentError.message);
  }

  revalidatePath("/studio/campaigns");
  if (job.campaign_id) revalidatePath(`/studio/campaigns/${job.campaign_id}`);
}

export async function saveCampaignMetric(form: FormData) {
  const { supabase, artist } = await runtimeContext(form);
  const marketing = asMarketingClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const campaignId = z.uuid().parse(value(form, "campaign_id"));
  const contentItemId = optionalUuid(form, "content_item_id");
  const variantId = optionalUuid(form, "content_variant_id");
  const experimentId = optionalUuid(form, "experiment_id");
  const releaseId = optionalUuid(form, "release_id");
  const platform = value(form, "platform");
  if (!platform) throw new Error("Platform is required.");

  await Promise.all([
    assertScopedId(marketing, artist, "campaigns", campaignId),
    assertScopedId(marketing, artist, "content_items", contentItemId),
    assertScopedId(marketing, artist, "content_variants", variantId),
    assertScopedId(marketing, artist, "campaign_experiments", experimentId),
  ]);
  if (releaseId) {
    const { data: release, error: releaseError } = await music.from("releases")
      .select("id")
      .eq("id", releaseId)
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (releaseError) throw new Error(releaseError.message);
    if (!release) throw new Error("Release does not belong to the active artist.");
  }

  const { error } = await marketing.from("metric_snapshots").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    date: value(form, "date") || new Date().toISOString().slice(0, 10),
    platform,
    release_id: releaseId,
    content_item_id: contentItemId,
    campaign_id: campaignId,
    experiment_id: experimentId,
    content_variant_id: variantId,
    source: "manual",
    captured_at: new Date().toISOString(),
    reach: numeric(form, "reach"),
    views: numeric(form, "views"),
    watch_time: numeric(form, "watch_time"),
    likes: numeric(form, "likes"),
    comments: numeric(form, "comments"),
    shares: numeric(form, "shares"),
    saves: numeric(form, "saves"),
    profile_visits: numeric(form, "profile_visits"),
    follows: numeric(form, "follows"),
    link_clicks: numeric(form, "link_clicks"),
    streams: numeric(form, "streams"),
    listeners: numeric(form, "listeners"),
    playlist_adds: numeric(form, "playlist_adds"),
    notes: value(form, "notes") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/campaigns/${campaignId}`);
  revalidatePath("/studio/analytics");
}
