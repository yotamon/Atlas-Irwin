"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { attachMediaAsset } from "@/app/studio/catalog-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { zonedDateTimeToUtc } from "@/lib/marketing/schedule";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asMomentAwareMarketingClient, asMomentsClient } from "@/lib/studio/moments-db";
import { deriveContentStatus } from "@/features/studio-v2/policy.mjs";

const required = z.string().trim().min(1).max(300);
const uuid = z.uuid();
const nonnegative = z.coerce.number().int().nonnegative();

function value(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function nullable(form: FormData, key: string) { return value(form, key) || null; }
function scheduledValue(form: FormData) {
  const raw = value(form, "scheduled_at");
  if (!raw) return null;
  const [date, time = "18:00"] = raw.split("T");
  return zonedDateTimeToUtc(date, time, "Europe/Berlin");
}

async function productionContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id") || null;
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, uuid.parse(requestedArtistId))
    : await resolveDefaultArtistContext(supabase, user);
  return { supabase, user, artist };
}

async function assertRelease(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  ownerId: string,
  artistId: string,
  releaseId: string | null,
) {
  if (!releaseId) return;
  const { data, error } = await asArtistScopedMusicClient(supabase).from("releases").select("id")
    .eq("id", releaseId).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Release does not belong to the active artist.");
}

export async function attachContentMediaV2(form: FormData) {
  const { supabase, artist } = await productionContext(form);
  const marketing = asMarketingClient(supabase);
  const contentItemId = uuid.parse(value(form, "content_item_id"));
  const mediaAssetId = uuid.parse(value(form, "media_asset_id"));
  const role = required.parse(value(form, "role"));

  const [itemResult, assetResult, lockResult] = await Promise.all([
    marketing.from("content_items").select("id,campaign_id,release_id,platform,status")
      .eq("id", contentItemId).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).single(),
    supabase.from("media_assets").select("id,public_url")
      .eq("id", mediaAssetId).eq("owner_id", artist.userId).single(),
    marketing.from("publication_jobs").select("id")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      .eq("content_item_id", contentItemId).eq("status", "provider_scheduled" as never).limit(1).maybeSingle(),
  ]);
  if (itemResult.error || !itemResult.data) throw new Error(itemResult.error?.message || "Content item not found for the active artist.");
  if (assetResult.error || !assetResult.data) throw new Error(assetResult.error?.message || "Media asset not found.");
  if (lockResult.error) throw new Error(lockResult.error.message);
  if (lockResult.data) throw new Error("This content is already scheduled with an external provider. Cancel or change it at the provider before replacing the creative in Ensemblis.");
  if (!assetResult.data.public_url) throw new Error("Content media must have a public URL before it can be used for publishing.");

  const attachForm = new FormData();
  attachForm.set("artist_id", artist.artistId);
  attachForm.set("media_asset_id", mediaAssetId);
  attachForm.set("content_item_id", contentItemId);
  attachForm.set("role", role);
  attachForm.set("is_primary", "on");
  await attachMediaAsset(attachForm);

  const { data: updated, error: updateError } = await marketing.from("content_items")
    .update({ asset_url: assetResult.data.public_url })
    .eq("id", contentItemId).eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
    .select("id,campaign_id,release_id,platform,status").single();
  if (updateError || !updated) throw new Error(updateError?.message || "Content media could not be attached.");

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: updated.campaign_id,
    event_type: updated.status === "Scheduled" ? "content.awaiting_publish_approval" : "content.updated",
    entity_type: "content_item",
    entity_id: updated.id,
    payload: { status: updated.status, platform: updated.platform, releaseId: updated.release_id, source: "contextual_media_upload" },
  });
  if (eventError) throw new Error(eventError.message);

  revalidatePath("/studio"); revalidatePath("/studio/production"); revalidatePath("/studio/calendar"); revalidatePath("/studio/inbox"); revalidatePath("/studio/library");
  if (updated.release_id) revalidatePath(`/studio/releases/${updated.release_id}`);
  return { assetUrl: assetResult.data.public_url, status: updated.status };
}

export async function saveContentV2(form: FormData) {
  const { supabase, artist } = await productionContext(form);
  const marketing = asMomentAwareMarketingClient(supabase);
  const moments = asMomentsClient(supabase);
  const id = value(form, "id");
  const releaseId = value(form, "release_id") ? uuid.parse(value(form, "release_id")) : null;
  const requestedMomentId = value(form, "moment_id") ? uuid.parse(value(form, "moment_id")) : null;
  const title = required.parse(value(form, "title"));
  const platform = required.parse(value(form, "platform"));
  const format = required.parse(value(form, "format"));
  const goal = value(form, "goal") || "Reach";
  const scheduledAt = scheduledValue(form);
  const caption = nullable(form, "caption");
  const hook = nullable(form, "hook_text");
  await assertRelease(supabase, artist.userId, artist.artistId, releaseId);

  const { data: existing, error: existingError } = id
    ? await marketing.from("content_items").select("*")
        .eq("id", uuid.parse(id)).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).single()
    : { data: null, error: null };
  if (existingError) throw new Error(existingError.message);

  if (id) {
    const { data: externallyScheduled, error: lockError } = await marketing.from("publication_jobs").select("id")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      .eq("content_item_id", id).eq("status", "provider_scheduled" as never).limit(1).maybeSingle();
    if (lockError) throw new Error(lockError.message);
    if (externallyScheduled) throw new Error("This content is already scheduled with an external provider. Cancel or change it at the provider before editing the creative or timing in Ensemblis.");
  }

  const momentId = requestedMomentId ?? existing?.moment_id ?? null;
  const attachingMoment = Boolean(momentId && momentId !== existing?.moment_id);
  if (momentId) {
    const { data: moment, error: momentError } = await moments.from("moments").select("id,release_id,artist_id,state")
      .eq("id", momentId).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).single();
    if (momentError || !moment) throw new Error(momentError?.message || "Moment not found for the active artist.");
    if (attachingMoment && moment.state !== "approved") throw new Error("Only an approved Moment can start new creative execution.");
    if (releaseId !== moment.release_id) throw new Error("Creative Release must match the selected Moment Release.");
  }

  const assetUrl = nullable(form, "asset_url_override") || existing?.asset_url || null;
  let campaignId = existing?.campaign_id ?? null;
  if (campaignId) {
    const { data: campaign, error } = await marketing.from("campaigns").select("id,release_id")
      .eq("id", campaignId).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campaign does not belong to the active artist.");
    if (releaseId && campaign.release_id && campaign.release_id !== releaseId) throw new Error("Campaign and content Release must match.");
  } else if (releaseId) {
    const { data: campaign, error } = await marketing.from("campaigns").select("id")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId).eq("release_id", releaseId)
      .not("status", "eq", "archived").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    campaignId = campaign?.id ?? null;
  }

  const status = deriveContentStatus({ current: existing?.status, publishedAt: existing?.published_at, scheduledAt, assetUrl, caption, hook });
  const row = {
    owner_id: artist.userId,
    artist_id: artist.artistId,
    release_id: releaseId,
    campaign_id: campaignId,
    moment_id: momentId,
    title, platform, format, goal, status,
    scheduled_at: scheduledAt,
    hook_text: hook,
    caption,
    cta: nullable(form, "cta"),
    asset_url: assetUrl,
    visual_prompt: nullable(form, "visual_prompt"),
    production_notes: nullable(form, "production_notes"),
    performance_notes: nullable(form, "performance_notes"),
    audio_timestamp_start: value(form, "audio_timestamp_start") ? nonnegative.parse(value(form, "audio_timestamp_start")) : null,
    audio_timestamp_end: value(form, "audio_timestamp_end") ? nonnegative.parse(value(form, "audio_timestamp_end")) : null,
    source: existing?.source ?? "manual",
    approval_status: existing?.approval_status ?? "not_required",
  } as const;

  const mutation = id
    ? marketing.from("content_items").update(row)
        .eq("id", uuid.parse(id)).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).select("id").single()
    : marketing.from("content_items").insert(row).select("id").single();
  const { data: saved, error } = await mutation;
  if (error) throw new Error(error.message);

  if (campaignId && momentId) {
    const { data: existingLink, error: linkLookupError } = await marketing.from("campaign_moments").select("id")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      .eq("campaign_id", campaignId).eq("moment_id", momentId).maybeSingle();
    if (linkLookupError) throw new Error(linkLookupError.message);
    if (!existingLink) {
      const { data: currentPrimary, error: primaryError } = await marketing.from("campaign_moments").select("id")
        .eq("owner_id", artist.userId).eq("artist_id", artist.artistId).eq("campaign_id", campaignId)
        .eq("role", "primary").eq("is_active", true).limit(1).maybeSingle();
      if (primaryError) throw new Error(primaryError.message);
      const { error: linkError } = await marketing.from("campaign_moments").insert({
        owner_id: artist.userId,
        artist_id: artist.artistId,
        campaign_id: campaignId,
        moment_id: momentId,
        role: currentPrimary ? "supporting" : "primary",
        is_active: true,
      });
      if (linkError) throw new Error(linkError.message);
    }
  }

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    event_type: status === "Scheduled" ? "content.awaiting_publish_approval" : "content.updated",
    entity_type: "content_item",
    entity_id: saved.id,
    payload: { status, platform, releaseId, momentId },
  });
  if (eventError) throw new Error(eventError.message);

  revalidatePath("/studio"); revalidatePath("/studio/production"); revalidatePath("/studio/calendar"); revalidatePath("/studio/inbox");
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
  redirect(`/studio/production?edit=${saved.id}&saved=1`);
}
