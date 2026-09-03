"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asMarketingClient } from "@/lib/marketing/db";
import {
  OBJECTIVE_KPIS,
  campaignPhasePlan,
  campaignWindow,
} from "@/lib/marketing/domain";
import { releaseRelativeTimestamp } from "@/lib/marketing/schedule";
import type { Json } from "@/types/database";

const required = z.string().trim().min(1).max(300);
const optionalUrl = z.union([z.literal(""), z.url()]).optional();

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}

function list(form: FormData, key: string) {
  return value(form, key)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "release"
  );
}

async function uniqueReleaseSlug(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  ownerId: string,
  artistId: string,
  title: string,
  preferred?: string,
  currentId?: string,
) {
  const db = asArtistScopedMusicClient(supabase);
  const base = slugify(preferred || title);
  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    // owner_id remains part of the legacy uniqueness contract during the compatibility
    // window, while artist_id prevents a release lookup from drifting into another artist.
    let query = db
      .from("releases")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("slug", slug);
    if (currentId) query = query.neq("id", currentId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
  }
  return `${base}-${Date.now()}`;
}

function automaticStatus(releaseDate: string | null, existingStatus?: string | null) {
  if (existingStatus === "Live" || existingStatus === "Archived") return existingStatus;
  if (!releaseDate) return existingStatus || "In Progress";
  const today = new Date().toISOString().slice(0, 10);
  return releaseDate > today ? "Scheduled" : existingStatus || "In Progress";
}

async function ensureReleaseCampaign({
  ownerId,
  releaseId,
  title,
  releaseDate,
  supabase,
}: {
  ownerId: string;
  releaseId: string;
  title: string;
  releaseDate: string | null;
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"];
}) {
  const marketing = asMarketingClient(supabase);
  const { data: existing, error: lookupError } = await marketing
    .from("campaigns")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("release_id", releaseId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) return existing.id;

  const objective = "Streams" as const;
  const kpis = OBJECTIVE_KPIS[objective];
  const window = campaignWindow(releaseDate);
  const { data: campaign, error } = await marketing
    .from("campaigns")
    .insert({
      owner_id: ownerId,
      release_id: releaseId,
      name: `${title} release plan`,
      status: "draft",
      mode: "assisted",
      objective,
      primary_kpi: kpis.primary,
      secondary_kpis: kpis.secondary,
      release_anchor_date: releaseDate,
      start_date: window.startDate,
      end_date: window.endDate,
      strategy: {} as Json,
      audience_segments: [] as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const phases = campaignPhasePlan(releaseDate).map((phase) => ({
    ...phase,
    owner_id: ownerId,
    campaign_id: campaign.id,
  }));
  const { error: phaseError } = await marketing.from("campaign_phases").insert(phases);
  if (phaseError) throw new Error(phaseError.message);

  await marketing.from("marketing_events").insert({
    owner_id: ownerId,
    campaign_id: campaign.id,
    event_type: "release.workspace_created",
    entity_type: "release",
    entity_id: releaseId,
    payload: { releaseDate, source: "studio_v2" } as Json,
  });

  return campaign.id;
}

async function shiftReleasePlan({
  ownerId,
  releaseId,
  releaseDate,
  supabase,
}: {
  ownerId: string;
  releaseId: string;
  releaseDate: string | null;
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"];
}) {
  if (!releaseDate) return;
  const marketing = asMarketingClient(supabase);
  const { data: campaigns, error } = await marketing
    .from("campaigns")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("release_id", releaseId);
  if (error) throw new Error(error.message);

  for (const campaign of campaigns ?? []) {
    const window = campaignWindow(releaseDate);
    const { error: campaignError } = await marketing
      .from("campaigns")
      .update({
        release_anchor_date: releaseDate,
        start_date: window.startDate,
        end_date: window.endDate,
      })
      .eq("id", campaign.id)
      .eq("owner_id", ownerId);
    if (campaignError) throw new Error(campaignError.message);

    const plan = campaignPhasePlan(releaseDate);
    for (const phase of plan) {
      const { error: phaseError } = await marketing
        .from("campaign_phases")
        .update({ starts_at: phase.starts_at, ends_at: phase.ends_at })
        .eq("campaign_id", campaign.id)
        .eq("code", phase.code)
        .eq("owner_id", ownerId);
      if (phaseError) throw new Error(phaseError.message);
    }

    const { data: relativeContent, error: contentError } = await marketing
      .from("content_items")
      .select("id,relative_day,schedule_local_time,schedule_timezone")
      .eq("campaign_id", campaign.id)
      .eq("owner_id", ownerId)
      .eq("schedule_locked", false)
      .is("published_at", null)
      .not("relative_day", "is", null);
    if (contentError) throw new Error(contentError.message);

    for (const item of relativeContent ?? []) {
      if (item.relative_day === null) continue;
      const scheduledAt = releaseRelativeTimestamp(
        releaseDate,
        item.relative_day,
        item.schedule_local_time || "18:00",
        item.schedule_timezone || "Europe/Berlin",
      );
      const { error: itemError } = await marketing
        .from("content_items")
        .update({ scheduled_at: scheduledAt })
        .eq("id", item.id)
        .eq("owner_id", ownerId);
      if (itemError) throw new Error(itemError.message);
    }

    await marketing.from("marketing_events").insert({
      owner_id: ownerId,
      campaign_id: campaign.id,
      event_type: "release.date_changed",
      entity_type: "release",
      entity_id: releaseId,
      payload: { releaseDate, source: "studio_v2" } as Json,
    });
  }
}

export async function saveReleaseV2(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = asArtistScopedMusicClient(supabase);
  const id = value(form, "id");
  const title = required.parse(value(form, "title"));
  const releaseType = required.parse(value(form, "release_type") || "Single");
  const releaseDate = nullable(form, "release_date");

  const { data: existing, error: existingError } = id
    ? await db
        .from("releases")
        .select("id,slug,status,release_date")
        .eq("id", id)
        .eq("artist_id", artist.artistId)
        .single()
    : { data: null, error: null };
  if (existingError) throw new Error(existingError.message);

  const requestedSlug = value(form, "slug");
  const slug = await uniqueReleaseSlug(
    supabase,
    user.id,
    artist.artistId,
    title,
    requestedSlug || existing?.slug || undefined,
    id || undefined,
  );
  const requestedStatus = value(form, "status");
  const status = requestedStatus || automaticStatus(releaseDate, existing?.status);

  const parsedUrls = z
    .object({
      spotify_url: optionalUrl,
      soundcloud_url: optionalUrl,
      youtube_url: optionalUrl,
      smart_link_url: optionalUrl,
      artwork_url: optionalUrl,
    })
    .parse({
      spotify_url: value(form, "spotify_url"),
      soundcloud_url: value(form, "soundcloud_url"),
      youtube_url: value(form, "youtube_url"),
      smart_link_url: value(form, "smart_link_url"),
      artwork_url: value(form, "artwork_url"),
    });

  const row = {
    owner_id: user.id,
    artist_id: artist.artistId,
    title,
    slug,
    release_type: releaseType,
    status,
    release_date: releaseDate,
    spotify_url: parsedUrls.spotify_url || null,
    soundcloud_url: parsedUrls.soundcloud_url || null,
    youtube_url: parsedUrls.youtube_url || null,
    smart_link_url: parsedUrls.smart_link_url || null,
    artwork_url: parsedUrls.artwork_url || null,
    story: nullable(form, "story"),
    core_emotion: nullable(form, "core_emotion"),
    audience: nullable(form, "audience"),
    primary_hook: nullable(form, "primary_hook"),
    visual_direction: nullable(form, "visual_direction"),
    color_palette: list(form, "color_palette"),
    notes: nullable(form, "notes"),
    cover_asset: nullable(form, "cover_asset"),
    public_slug: nullable(form, "public_slug"),
    public_release_path: nullable(form, "public_release_path"),
  };

  const query = id
    ? db
        .from("releases")
        .update(row)
        .eq("id", id)
        .eq("artist_id", artist.artistId)
        .select("id")
        .single()
    : db.from("releases").insert(row).select("id").single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  await ensureReleaseCampaign({
    ownerId: user.id,
    releaseId: data.id,
    title,
    releaseDate,
    supabase,
  });

  if (existing && existing.release_date !== releaseDate) {
    await shiftReleasePlan({
      ownerId: user.id,
      releaseId: data.id,
      releaseDate,
      supabase,
    });
  }

  revalidatePath("/studio");
  revalidatePath("/studio/releases");
  revalidatePath(`/studio/releases/${data.id}`);
  redirect(`/studio/releases/${data.id}`);
}
