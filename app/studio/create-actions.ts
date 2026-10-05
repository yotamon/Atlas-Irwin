"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { saveContentV2 } from "@/app/studio/content-actions-v2";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { artistCreativePolicyBrief } from "@/lib/artist-operating/domain";
import { loadArtistOperatingContext } from "@/lib/artist-operating/server";
import { artistMemoryBrief, loadArtistMemoryForConsumer } from "@/lib/artist-memory/server";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { resolveCreateOutcome } from "@/lib/studio/create-outcomes";
import { asMomentAwareMarketingClient, asMomentsClient } from "@/lib/studio/moments-db";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

const uuid = z.uuid();
function value(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }

export async function startOutcomeCreative(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artistId = uuid.parse(value(form, "artist_id"));
  const artist = await resolveArtistContext(supabase, user, artistId);
  const momentId = uuid.parse(value(form, "moment_id"));
  const outcome = resolveCreateOutcome(value(form, "outcome"));
  if (!outcome) throw new Error("Choose a valid creative outcome.");

  const moments = asMomentsClient(supabase);
  const [{ data: moment, error }, memory, operatingContext] = await Promise.all([
    moments.from("moments").select("id,release_id,label,start_ms,end_ms,state").eq("id", momentId).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).maybeSingle(),
    loadArtistMemoryForConsumer({ db: supabase, ownerId: artist.userId, artistId: artist.artistId, consumer: "creative_direction" }),
    loadArtistOperatingContext({ db: supabase, artist }),
  ]);
  if (error) throw new Error(error.message);
  if (!moment) throw new Error("Moment not found for the active artist.");
  if (moment.state !== "approved") throw new Error("Only an approved Moment can start creative execution.");

  const rememberedDirection = artistMemoryBrief(memory.items, 1_800);
  const notes = [
    `Creative outcome: ${outcome.label}. ${outcome.description}`,
    artistCreativePolicyBrief(operatingContext.profile),
    rememberedDirection ? `Bounded Artist Memory (${memory.maxEffect.replaceAll("_", " ")}):\n${rememberedDirection}` : null,
  ].filter(Boolean).join("\n\n");

  if (outcome.workflow === "living_artwork") {
    const marketing = asMomentAwareMarketingClient(supabase);
    const { data: campaign, error: campaignError } = await marketing.from("campaigns")
      .select("id")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("release_id", moment.release_id)
      .not("status", "eq", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (campaignError) throw new Error(campaignError.message);

    const { data: content, error: contentError } = await marketing.from("content_items").insert({
      owner_id: artist.userId,
      artist_id: artist.artistId,
      release_id: moment.release_id,
      campaign_id: campaign?.id ?? null,
      moment_id: moment.id,
      title: `${moment.label} · ${outcome.titleSuffix}`,
      platform: outcome.platform,
      format: outcome.format,
      goal: outcome.goal,
      status: "Draft",
      scheduled_at: null,
      hook_text: null,
      caption: null,
      cta: null,
      asset_url: null,
      visual_prompt: null,
      production_notes: notes,
      performance_notes: null,
      audio_timestamp_start: Math.floor(moment.start_ms / 1000),
      audio_timestamp_end: Math.ceil(moment.end_ms / 1000),
      source: "manual",
      approval_status: "not_required",
    }).select("id").single();
    if (contentError || !content) throw new Error(contentError?.message || "Could not start Living Artwork.");

    const { error: eventError } = await marketing.from("marketing_events").insert({
      owner_id: artist.userId,
      artist_id: artist.artistId,
      campaign_id: campaign?.id ?? null,
      event_type: "loop_workflow_started",
      entity_type: "content_item",
      entity_id: content.id,
      payload: { releaseId: moment.release_id, momentId: moment.id, outcome: outcome.id },
    });
    if (eventError) throw new Error(eventError.message);

    redirect(ensemblisArtistHref(`/studio/create/loop/${content.id}`, artist.artistId));
  }

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
