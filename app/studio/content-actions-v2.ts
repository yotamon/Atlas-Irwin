"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { zonedDateTimeToUtc } from "@/lib/marketing/schedule";
import { deriveContentStatus } from "@/features/studio-v2/policy.mjs";

const required = z.string().trim().min(1).max(300);
const uuid = z.uuid();
const nonnegative = z.coerce.number().int().nonnegative();

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}
function scheduledValue(form: FormData) {
  const raw = value(form, "scheduled_at");
  if (!raw) return null;
  const [date, time = "18:00"] = raw.split("T");
  return zonedDateTimeToUtc(date, time, "Europe/Berlin");
}

export async function saveContentV2(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const id = value(form, "id");
  const releaseId = value(form, "release_id") ? uuid.parse(value(form, "release_id")) : null;
  const title = required.parse(value(form, "title"));
  const platform = required.parse(value(form, "platform"));
  const format = required.parse(value(form, "format"));
  const goal = value(form, "goal") || "Reach";
  const scheduledAt = scheduledValue(form);
  const caption = nullable(form, "caption");
  const hook = nullable(form, "hook_text");

  const { data: existing, error: existingError } = id
    ? await marketing.from("content_items").select("*").eq("id", id).eq("owner_id", user.id).single()
    : { data: null, error: null };
  if (existingError) throw new Error(existingError.message);

  if (id) {
    const { data: externallyScheduled, error: lockError } = await marketing
      .from("publication_jobs")
      .select("id")
      .eq("owner_id", user.id)
      .eq("content_item_id", id)
      .eq("status", "provider_scheduled" as never)
      .limit(1)
      .maybeSingle();
    if (lockError) throw new Error(lockError.message);
    if (externallyScheduled) {
      throw new Error("This content is already scheduled with an external provider. Cancel or change it at the provider before editing the creative or timing in Atlas.");
    }
  }

  const assetUrl = nullable(form, "asset_url_override") || existing?.asset_url || null;
  let campaignId = existing?.campaign_id ?? null;
  if (!campaignId && releaseId) {
    const { data: campaign, error } = await marketing
      .from("campaigns")
      .select("id")
      .eq("owner_id", user.id)
      .eq("release_id", releaseId)
      .not("status", "eq", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    campaignId = campaign?.id ?? null;
  }

  const status = deriveContentStatus({ current: existing?.status, publishedAt: existing?.published_at, scheduledAt, assetUrl, caption, hook });
  const row = {
    owner_id: user.id,
    release_id: releaseId,
    campaign_id: campaignId,
    title,
    platform,
    format,
    goal,
    status,
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
    ? marketing.from("content_items").update(row).eq("id", id).eq("owner_id", user.id).select("id").single()
    : marketing.from("content_items").insert(row).select("id").single();
  const { data: saved, error } = await mutation;
  if (error) throw new Error(error.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: campaignId,
    event_type: status === "Scheduled" ? "content.awaiting_publish_approval" : "content.updated",
    entity_type: "content_item",
    entity_id: saved.id,
    payload: { status, platform, releaseId },
  });
  if (eventError) throw new Error(eventError.message);

  revalidatePath("/studio");
  revalidatePath("/studio/production");
  revalidatePath("/studio/calendar");
  revalidatePath("/studio/inbox");
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
  redirect(`/studio/production?edit=${saved.id}&saved=1`);
}
