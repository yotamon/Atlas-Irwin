"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { TemplateContentGenerationProvider } from "@/lib/studio/generation";
import {
  disconnectSoundCloud,
  soundCloudSnapshot,
  syncSoundCloudCatalog,
  syncSoundCloudTrack,
  uploadSoundCloudTrack,
} from "@/lib/studio/soundcloud";
import type { MetricSnapshot, SoundCloudTrack } from "@/types/database";

const text = z.string().trim().max(10000);
const required = z.string().trim().min(1).max(300);
const optionalUrl = z.union([z.literal(""), z.url()]).optional();
const number = z.coerce.number().int().nonnegative().default(0);
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
      .slice(0, 70) || "soundcloud-track"
  );
}
async function uniqueReleaseSlug(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  ownerId: string,
  title: string,
) {
  const base = slugify(title);
  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const { data, error } = await supabase
      .from("releases")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function signInWithStudioPassword(form: FormData) {
  const password = z.string().min(1).parse(value(form, "password"));
  const email = value(form, "email") || undefined;
  const { createClient } = await import("@/lib/supabase/server");
  const { signInStudioAdmin } = await import("@/lib/auth/studio-login");
  const supabase = await createClient();
  try {
    await signInStudioAdmin(supabase, email, password);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sign in.";
    redirect(`/studio/login?error=${encodeURIComponent(message)}`);
  }
  redirect("/studio");
}

export async function signOut() {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/studio/login");
}

export async function saveRelease(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = value(form, "id");
  const parsed = z
    .object({
      title: required,
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      release_type: required,
      status: required,
      spotify_url: optionalUrl,
      soundcloud_url: optionalUrl,
      youtube_url: optionalUrl,
      smart_link_url: optionalUrl,
      artwork_url: optionalUrl,
    })
    .parse(Object.fromEntries(form));
  const row = {
    ...parsed,
    owner_id: user.id,
    release_date: nullable(form, "release_date"),
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
    ? supabase.from("releases").update(row).eq("id", id).select("id").single()
    : supabase.from("releases").insert(row).select("id").single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/studio");
  redirect(`/studio/releases/${data.id}`);
}

export async function deleteRelease(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { error } = await supabase.from("releases").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/releases");
  redirect("/studio/releases");
}

export async function saveCoverAsset(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const cover_asset = required.parse(value(form, "cover_asset"));
  const { error } = await supabase
    .from("releases")
    .update({ cover_asset })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/releases/${id}`);
}

export async function saveTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const release_id = z.uuid().parse(value(form, "release_id"));
  const { error } = await supabase.from("tracks").insert({
    owner_id: user.id,
    release_id,
    title: required.parse(value(form, "title")),
    version: nullable(form, "version"),
    duration: value(form, "duration")
      ? number.parse(value(form, "duration"))
      : null,
    audio_url: nullable(form, "audio_url"),
    soundcloud_url: nullable(form, "soundcloud_url"),
    spotify_url: nullable(form, "spotify_url"),
    is_primary: form.get("is_primary") === "on",
    notes: nullable(form, "notes"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/releases/${release_id}`);
}

export async function updateReadiness(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const readiness = Object.fromEntries(
    form.getAll("item").map((item) => [String(item), true]),
  );
  const { error } = await supabase
    .from("releases")
    .update({ readiness })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/releases/${id}`);
}

export async function generateIdentity(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { data, error } = await supabase
    .from("releases")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const generator = new TemplateContentGenerationProvider();
  const release_identity = await generator.generateReleaseIdentity(data);
  const story_answers = {
    emotional_moment: value(form, "emotional_moment"),
    musical_distinction: value(form, "musical_distinction"),
    visual_world: value(form, "visual_world"),
    likely_listener: value(form, "likely_listener"),
    listener_feeling: value(form, "listener_feeling"),
    ai_narrative: value(form, "ai_narrative"),
    exclusions: value(form, "exclusions"),
  };
  await supabase
    .from("releases")
    .update({ story_answers, release_identity })
    .eq("id", id);
  revalidatePath(`/studio/releases/${id}`);
}

export async function generateContentPack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { data, error } = await supabase
    .from("releases")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const items =
    await new TemplateContentGenerationProvider().generateContentPack(data);
  const { error: insertError } = await supabase
    .from("content_items")
    .insert(
      items.map((item) => ({ ...item, owner_id: user.id, release_id: id })),
    );
  if (insertError) throw new Error(insertError.message);
  revalidatePath("/studio/content");
  redirect(`/studio/content?release=${id}&generated=1`);
}

export async function saveContent(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = value(form, "id");
  const row = {
    owner_id: user.id,
    release_id: nullable(form, "release_id"),
    title: required.parse(value(form, "title")),
    platform: required.parse(value(form, "platform")),
    format: required.parse(value(form, "format")),
    status: required.parse(value(form, "status")),
    goal: required.parse(value(form, "goal")),
    scheduled_at: nullable(form, "scheduled_at"),
    published_at: nullable(form, "published_at"),
    audio_timestamp_start: value(form, "audio_timestamp_start")
      ? number.parse(value(form, "audio_timestamp_start"))
      : null,
    audio_timestamp_end: value(form, "audio_timestamp_end")
      ? number.parse(value(form, "audio_timestamp_end"))
      : null,
    hook_text: nullable(form, "hook_text"),
    caption: nullable(form, "caption"),
    cta: nullable(form, "cta"),
    visual_prompt: nullable(form, "visual_prompt"),
    production_notes: nullable(form, "production_notes"),
    asset_url: nullable(form, "asset_url"),
    performance_notes: nullable(form, "performance_notes"),
  };
  const { error } = id
    ? await supabase.from("content_items").update(row).eq("id", id)
    : await supabase.from("content_items").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/content");
  revalidatePath("/studio/calendar");
}

export async function updateContentStatus(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const status = required.parse(value(form, "status"));
  const { error } = await supabase
    .from("content_items")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/content");
  revalidatePath("/studio/calendar");
}

export async function duplicateContent(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const { id: _id, created_at: _c, updated_at: _u, ...copy } = data;
  void _id;
  void _c;
  void _u;
  await supabase.from("content_items").insert({
    ...copy,
    owner_id: user.id,
    title: `${copy.title} (copy)`,
    status: "Draft",
    published_at: null,
  });
  revalidatePath("/studio/content");
}

export async function saveContact(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = value(form, "id");
  const row = {
    owner_id: user.id,
    name: required.parse(value(form, "name")),
    platform: nullable(form, "platform"),
    handle_or_url: nullable(form, "handle_or_url"),
    email: nullable(form, "email"),
    city: nullable(form, "city"),
    country: nullable(form, "country"),
    contact_type: required.parse(value(form, "contact_type")),
    genres: list(form, "genres"),
    audience_size: value(form, "audience_size")
      ? number.parse(value(form, "audience_size"))
      : null,
    contact_method: nullable(form, "contact_method"),
    relationship_status: required.parse(value(form, "relationship_status")),
    notes: nullable(form, "notes"),
    tags: list(form, "tags"),
  };
  const { error } = id
    ? await supabase.from("outreach_contacts").update(row).eq("id", id)
    : await supabase.from("outreach_contacts").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
}

export async function saveOutreachMessage(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const { error } = await supabase.from("outreach_messages").insert({
    owner_id: user.id,
    contact_id: z.uuid().parse(value(form, "contact_id")),
    release_id: nullable(form, "release_id"),
    channel: required.parse(value(form, "channel")),
    message: text.parse(value(form, "message")),
    sent_at: nullable(form, "sent_at"),
    follow_up_at: nullable(form, "follow_up_at"),
    response_status: nullable(form, "response_status"),
    response_notes: nullable(form, "response_notes"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
}

export async function updateOutreachResponse(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { error } = await supabase
    .from("outreach_messages")
    .update({
      response_status: nullable(form, "response_status"),
      response_notes: nullable(form, "response_notes"),
      follow_up_at: nullable(form, "follow_up_at"),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
}

export async function saveMetric(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const numeric = [
    "reach",
    "views",
    "watch_time",
    "likes",
    "comments",
    "shares",
    "saves",
    "profile_visits",
    "follows",
    "link_clicks",
    "streams",
    "listeners",
    "playlist_adds",
  ] as const;
  const row: Partial<MetricSnapshot> & Pick<MetricSnapshot, "owner_id" | "date" | "platform"> = {
    owner_id: user.id,
    date: required.parse(value(form, "date")),
    platform: required.parse(value(form, "platform")),
    release_id: nullable(form, "release_id"),
    content_item_id: nullable(form, "content_item_id"),
    notes: nullable(form, "notes"),
  };
  numeric.forEach((key) => (row[key] = number.parse(value(form, key) || "0")));
  const id = value(form, "id");
  const { error } = id
    ? await supabase
        .from("metric_snapshots")
        .update(row)
        .eq("id", z.uuid().parse(id))
    : await supabase.from("metric_snapshots").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/analytics");
}

export async function saveLearning(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const release_id = z.uuid().parse(value(form, "release_id"));
  const learning = text.min(3).parse(value(form, "learning"));
  const { error } = await supabase
    .from("release_learnings")
    .insert({ owner_id: user.id, release_id, learning });
  if (error) throw new Error(error.message);
  revalidatePath("/studio/analytics");
}

export async function deleteStudioRecord(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const table = z
    .enum([
      "tracks",
      "content_items",
      "outreach_contacts",
      "outreach_messages",
      "metric_snapshots",
      "release_learnings",
      "brand_settings",
    ])
    .parse(value(form, "table"));
  let error: { message: string } | null = null;
  if (table === "tracks")
    ({ error } = await supabase.from("tracks").delete().eq("id", id));
  if (table === "content_items")
    ({ error } = await supabase.from("content_items").delete().eq("id", id));
  if (table === "outreach_contacts")
    ({ error } = await supabase
      .from("outreach_contacts")
      .delete()
      .eq("id", id));
  if (table === "outreach_messages")
    ({ error } = await supabase
      .from("outreach_messages")
      .delete()
      .eq("id", id));
  if (table === "metric_snapshots")
    ({ error } = await supabase.from("metric_snapshots").delete().eq("id", id));
  if (table === "release_learnings")
    ({ error } = await supabase
      .from("release_learnings")
      .delete()
      .eq("id", id));
  if (table === "brand_settings")
    ({ error } = await supabase.from("brand_settings").delete().eq("id", id));
  if (error) throw new Error(error.message);
  revalidatePath("/studio");
}

export async function syncSoundCloud(form: FormData) {
  const { user } = await requireStudioAdmin();
  await syncSoundCloudCatalog(user.id);
  revalidatePath("/studio/soundcloud");
  if (value(form, "redirect") !== "false") redirect("/studio/soundcloud?synced=1");
}

export async function disconnectSoundCloudAccount() {
  const { user } = await requireStudioAdmin();
  await disconnectSoundCloud(user.id);
  revalidatePath("/studio/soundcloud");
  redirect("/studio/soundcloud?disconnected=1");
}

export async function uploadTrackToSoundCloud(form: FormData) {
  const { user } = await requireStudioAdmin();
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose an audio file to upload to SoundCloud.");
  }
  const title = required.parse(value(form, "title"));
  await uploadSoundCloudTrack({
    ownerId: user.id,
    title,
    file,
    description: nullable(form, "description"),
    genre: nullable(form, "genre"),
    sharing: nullable(form, "sharing") || "private",
  });
  revalidatePath("/studio/soundcloud");
  redirect("/studio/soundcloud?uploaded=1");
}

export async function importSoundCloudTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { data: track, error: trackError } = await supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("id", id)
    .single();
  if (trackError) throw new Error(trackError.message);

  const { data: existingRelease, error: existingError } = await supabase
    .from("releases")
    .select("id")
    .eq("owner_id", user.id)
    .eq("soundcloud_url", track.permalink_url)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let releaseId = existingRelease?.id;
  if (!releaseId) {
    const slug = await uniqueReleaseSlug(supabase, user.id, track.title);
    const { data: release, error: releaseError } = await supabase
      .from("releases")
      .insert({
        owner_id: user.id,
        title: track.title,
        slug,
        release_type: "Single",
        status: "Live",
        story: track.description,
        soundcloud_url: track.permalink_url,
        artwork_url: track.artwork_url,
        release_date: null,
      })
      .select("id")
      .single();
    if (releaseError) throw new Error(releaseError.message);
    releaseId = release.id;
  }

  const { data: existingTrack, error: existingTrackError } = await supabase
    .from("tracks")
    .select("id")
    .eq("release_id", releaseId)
    .eq("soundcloud_url", track.permalink_url)
    .maybeSingle();
  if (existingTrackError) throw new Error(existingTrackError.message);
  if (!existingTrack) {
    const { error } = await supabase.from("tracks").insert({
      owner_id: user.id,
      release_id: releaseId,
      title: track.title,
      duration: track.duration ? Math.round(track.duration / 1000) : null,
      soundcloud_url: track.permalink_url,
      is_primary: true,
      notes: `Imported from SoundCloud track ${track.soundcloud_id}.`,
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/studio/releases");
  revalidatePath("/studio/soundcloud");
  redirect(`/studio/releases/${releaseId}`);
}

export async function syncSoundCloudMetrics() {
  const { supabase, user } = await requireStudioAdmin();
  const { data: tracks, error } = await supabase
    .from("soundcloud_tracks")
    .select("*")
    .order("synced_at", { ascending: false });
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);

  for (const storedTrack of tracks ?? []) {
    const track = await syncSoundCloudTrack(user.id, storedTrack.soundcloud_id);
    const { data: release, error: releaseError } = await supabase
      .from("releases")
      .select("id")
      .eq("owner_id", user.id)
      .eq("soundcloud_url", track.permalink_url)
      .maybeSingle();
    if (releaseError) throw new Error(releaseError.message);
    if (!release) continue;

    const notes = `SoundCloud API sync: ${track.soundcloud_id}`;
    const snapshot = soundCloudSnapshot(track as SoundCloudTrack);
    const row = {
      owner_id: user.id,
      date: today,
      platform: "SoundCloud",
      release_id: release.id,
      content_item_id: null,
      reach: snapshot.views,
      views: snapshot.views,
      watch_time: 0,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
      saves: 0,
      profile_visits: 0,
      follows: 0,
      link_clicks: 0,
      streams: snapshot.streams,
      listeners: 0,
      playlist_adds: 0,
      notes,
    };
    const { data: existing, error: metricLookupError } = await supabase
      .from("metric_snapshots")
      .select("id")
      .eq("owner_id", user.id)
      .eq("date", today)
      .eq("platform", "SoundCloud")
      .eq("release_id", release.id)
      .eq("notes", notes)
      .maybeSingle();
    if (metricLookupError) throw new Error(metricLookupError.message);
    const { error: metricError } = existing
      ? await supabase
          .from("metric_snapshots")
          .update(row)
          .eq("id", existing.id)
      : await supabase.from("metric_snapshots").insert(row);
    if (metricError) throw new Error(metricError.message);
  }
  revalidatePath("/studio/analytics");
  revalidatePath("/studio/soundcloud");
  redirect("/studio/soundcloud?metrics=1");
}

export async function saveBrandSetting(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const section = required.parse(value(form, "section"));
  const content = { text: text.parse(value(form, "content")) };
  const { error } = await supabase
    .from("brand_settings")
    .upsert(
      { owner_id: user.id, section, content },
      { onConflict: "owner_id,section" },
    );
  if (error) throw new Error(error.message);
  revalidatePath("/studio/brand");
}
