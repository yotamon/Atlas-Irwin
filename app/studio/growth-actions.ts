"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { OBJECTIVE_KPIS } from "@/lib/marketing/domain";
import { plannerPlatformsFromConnections } from "@/lib/marketing/social-platforms";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import {
  detectGrowthOpportunities,
  planReleaseQueue,
} from "@/lib/studio/growth";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { asSocialClient } from "@/lib/studio/social-db";
import type { Json } from "@/types/database";
import type { VaultTrackStatus } from "@/types/growth-database";

const uuid = z.uuid();
const shortText = z.string().trim().min(1).max(300);
const statusSchema = z.enum(["idea","demo","mix","mastered","release_candidate","scheduled","released","hold","archived"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function optional(form: FormData, key: string) {
  return value(form, key) || null;
}
function integer(form: FormData, key: string, fallback: number, min = 0, max = 100) {
  const raw = value(form, key);
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}
function json(input: unknown) {
  return input as Json;
}
function slugify(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "artist-track";
}

async function getGrowthActionContext() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  return {
    supabase,
    user,
    artist,
    growth: asGrowthClient(supabase),
    marketing: asMarketingClient(supabase),
    music: asArtistScopedMusicClient(supabase),
    operational: asArtistScopedOperationalClient(supabase),
    social: asSocialClient(supabase),
  };
}

type GrowthActionContext = Awaited<ReturnType<typeof getGrowthActionContext>>;

async function uniqueReleaseSlug(ctx: GrowthActionContext, title: string) {
  const base = slugify(title);
  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const { data, error } = await ctx.music
      .from("releases")
      .select("id")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function ensureGrowthSettings(ctx: GrowthActionContext) {
  const { data, error } = await ctx.growth
    .from("artist_growth_settings")
    .select("*")
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  const { data: created, error: createError } = await ctx.growth
    .from("artist_growth_settings")
    .insert({ owner_id: ctx.user.id, artist_id: ctx.artist.artistId })
    .select("*")
    .single();
  if (createError) throw new Error(createError.message);
  return created;
}

export async function saveGrowthSettings(form: FormData) {
  const ctx = await getGrowthActionContext();
  const row = {
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    planning_horizon_days: integer(form, "planning_horizon_days", 90, 30, 365),
    release_cadence_days: integer(form, "release_cadence_days", 28, 7, 120),
    minimum_candidate_score: integer(form, "minimum_candidate_score", 55, 0, 100),
    catalog_engine_enabled: form.get("catalog_engine_enabled") === "on",
    autoplan_enabled: form.get("autoplan_enabled") === "on",
  };
  const { error } = await ctx.growth
    .from("artist_growth_settings")
    .upsert(row, { onConflict: "artist_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
}

export async function saveVaultTrack(form: FormData) {
  const ctx = await getGrowthActionContext();
  const id = value(form, "id");
  const status = statusSchema.parse(value(form, "status") || "mastered") as VaultTrackStatus;
  const artistRatingRaw = value(form, "artist_rating");
  const row = {
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    title: shortText.parse(value(form, "title")),
    version: optional(form, "version"),
    status,
    audio_url: optional(form, "audio_url"),
    duration_seconds: value(form, "duration_seconds") ? integer(form, "duration_seconds", 0, 0, 60 * 60) : null,
    notes: optional(form, "notes"),
    artist_rating: artistRatingRaw ? integer(form, "artist_rating", 3, 1, 5) : null,
    hook_strength: integer(form, "hook_strength", 50),
    short_form_potential: integer(form, "short_form_potential", 50),
    visual_potential: integer(form, "visual_potential", 50),
    uniqueness_score: integer(form, "uniqueness_score", 50),
    release_readiness: integer(form, "release_readiness", 50),
    hook_start_seconds: value(form, "hook_start_seconds") ? integer(form, "hook_start_seconds", 0, 0, 60 * 60) : null,
    hook_end_seconds: value(form, "hook_end_seconds") ? integer(form, "hook_end_seconds", 0, 0, 60 * 60) : null,
    hold_until: optional(form, "hold_until"),
    source: id ? undefined : "manual" as const,
  };
  const query = id
    ? ctx.growth
        .from("track_vault")
        .update(row)
        .eq("id", uuid.parse(id))
        .eq("owner_id", ctx.user.id)
        .eq("artist_id", ctx.artist.artistId)
    : ctx.growth.from("track_vault").insert(row);
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
}

export async function archiveVaultTrack(form: FormData) {
  const ctx = await getGrowthActionContext();
  const id = uuid.parse(value(form, "id"));
  const { error } = await ctx.growth
    .from("track_vault")
    .update({ status: "archived" })
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/growth");
}

export async function generateGrowthPlan() {
  const ctx = await getGrowthActionContext();
  const settings = await ensureGrowthSettings(ctx);
  const [vaultResult, releasesResult] = await Promise.all([
    ctx.growth
      .from("track_vault")
      .select("*")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId)
      .neq("status", "archived"),
    ctx.music
      .from("releases")
      .select("id,release_date,status")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId)
      .in("status", ["Idea","In Progress","Scheduled"]),
  ]);
  if (vaultResult.error) throw new Error(vaultResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);

  const plan = planReleaseQueue({
    tracks: vaultResult.data ?? [],
    existingReleaseDates: (releasesResult.data ?? []).map((release) => release.release_date).filter((date): date is string => Boolean(date)),
    settings,
  });
  const { error: deleteError } = await ctx.growth
    .from("growth_plan_items")
    .delete()
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId)
    .eq("status", "proposed")
    .eq("source", "decision_engine");
  if (deleteError) throw new Error(deleteError.message);
  if (plan.length) {
    const { error } = await ctx.growth.from("growth_plan_items").insert(plan.map((item, index) => ({
      owner_id: ctx.user.id,
      artist_id: ctx.artist.artistId,
      track_vault_id: item.track.id,
      target_date: item.targetDate,
      sort_order: index,
      candidate_score: item.score,
      rationale: item.rationale,
      status: "proposed" as const,
      source: "decision_engine" as const,
    })));
    if (error) throw new Error(error.message);
  }
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
}

export async function promoteVaultTrack(form: FormData) {
  const ctx = await getGrowthActionContext();
  const id = uuid.parse(value(form, "id"));
  const { data: track, error } = await ctx.growth
    .from("track_vault")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId)
    .single();
  if (error) throw new Error(error.message);
  if (track.linked_release_id) redirect(`/studio/releases/${track.linked_release_id}`);

  const { data: planItem, error: planError } = await ctx.growth
    .from("growth_plan_items")
    .select("*")
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId)
    .eq("track_vault_id", id)
    .in("status", ["proposed","accepted"])
    .order("target_date")
    .limit(1)
    .maybeSingle();
  if (planError) throw new Error(planError.message);
  const releaseDate = planItem?.target_date ?? optional(form, "release_date");
  const slug = await uniqueReleaseSlug(ctx, track.title);
  const { data: release, error: releaseError } = await ctx.music.from("releases").insert({
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    title: track.title,
    slug,
    release_type: "Single",
    status: releaseDate ? "Scheduled" : "In Progress",
    release_date: releaseDate,
    primary_hook: track.hook_start_seconds != null ? `Primary hook starts around ${track.hook_start_seconds}s` : null,
    notes: track.notes,
  }).select("id").single();
  if (releaseError) throw new Error(releaseError.message);
  const { error: trackError } = await ctx.music.from("tracks").insert({
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    release_id: release.id,
    title: track.title,
    version: track.version,
    duration: track.duration_seconds,
    audio_url: track.audio_url,
    is_primary: true,
    notes: track.notes,
  });
  if (trackError) throw new Error(trackError.message);
  const { error: vaultError } = await ctx.growth.from("track_vault").update({
    linked_release_id: release.id,
    status: releaseDate ? "scheduled" : "release_candidate",
  })
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId);
  if (vaultError) throw new Error(vaultError.message);
  if (planItem) {
    const { error: planUpdateError } = await ctx.growth
      .from("growth_plan_items")
      .update({ release_id: release.id, status: releaseDate ? "scheduled" : "accepted" })
      .eq("id", planItem.id)
      .eq("artist_id", ctx.artist.artistId);
    if (planUpdateError) throw new Error(planUpdateError.message);
  }
  revalidatePath("/studio/growth");
  revalidatePath("/studio/releases");
  revalidatePath("/studio");
  redirect(`/studio/releases/${release.id}`);
}

export async function refreshGrowthOpportunities() {
  const ctx = await getGrowthActionContext();
  const [settings, vaultResult, releasesResult, metricsResult, contentResult, existingResult] = await Promise.all([
    ensureGrowthSettings(ctx),
    ctx.growth
      .from("track_vault")
      .select("*")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId)
      .neq("status", "archived"),
    ctx.music
      .from("releases")
      .select("id,title,status,release_date")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId),
    ctx.marketing
      .from("metric_snapshots")
      .select("*")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId),
    ctx.marketing
      .from("content_items")
      .select("id,release_id,title,status,asset_url")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId),
    ctx.growth
      .from("growth_opportunities")
      .select("id,dedupe_key,status")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId),
  ]);
  if (vaultResult.error) throw new Error(vaultResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (existingResult.error) throw new Error(existingResult.error.message);
  if (!settings.catalog_engine_enabled) {
    revalidatePath("/studio/growth");
    return;
  }
  const existing = new Map((existingResult.data ?? []).map((item) => [item.dedupe_key, item]));
  const drafts = detectGrowthOpportunities({
    releases: releasesResult.data ?? [],
    metrics: metricsResult.data ?? [],
    content: contentResult.data ?? [],
    vault: vaultResult.data ?? [],
  });
  if (drafts.length) {
    const rows = drafts.map((draft) => {
      const previous = existing.get(draft.dedupeKey);
      const preservedStatus = previous && ["dismissed","completed"].includes(previous.status) ? previous.status : "new";
      return {
        owner_id: ctx.user.id,
        artist_id: ctx.artist.artistId,
        kind: draft.kind,
        release_id: draft.releaseId ?? null,
        track_vault_id: draft.trackVaultId ?? null,
        content_item_id: draft.contentItemId ?? null,
        title: draft.title,
        rationale: draft.rationale,
        priority: draft.priority,
        confidence: draft.confidence,
        evidence: json(draft.evidence),
        recommended_action: json(draft.recommendedAction),
        dedupe_key: draft.dedupeKey,
        status: preservedStatus as "new" | "dismissed" | "completed",
        detected_at: new Date().toISOString(),
      };
    });
    const { error } = await ctx.growth
      .from("growth_opportunities")
      .upsert(rows, { onConflict: "artist_id,dedupe_key" });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
}

async function createCatalogRevivalCampaign(ctx: GrowthActionContext, releaseId: string, opportunityId: string) {
  const [{ data: release, error: releaseError }, socialResult] = await Promise.all([
    ctx.music
      .from("releases")
      .select("id,title,release_date,primary_hook,core_emotion")
      .eq("id", releaseId)
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId)
      .single(),
    ctx.social
      .from("social_channel_accounts")
      .select("platform,status")
      .eq("owner_id", ctx.user.id)
      .eq("artist_id", ctx.artist.artistId)
      .eq("status", "connected"),
  ]);
  if (releaseError) throw new Error(releaseError.message);
  if (socialResult.error) throw new Error(socialResult.error.message);
  const connectedPlatforms = plannerPlatformsFromConnections(socialResult.data ?? []);
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const kpis = OBJECTIVE_KPIS.Streams;
  const { data: campaign, error } = await ctx.marketing.from("campaigns").insert({
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    release_id: release.id,
    name: `${release.title} catalog revival`,
    status: "planned",
    mode: "assisted",
    objective: "Streams",
    primary_kpi: kpis.primary,
    secondary_kpis: kpis.secondary,
    audience_segments: json([]),
    strategy: json({
      source: "catalog_opportunity",
      opportunityId,
      strategySummary: "Re-surface a proven catalog track using its strongest existing audience signal, then scale only the concepts that convert into music intent.",
      connectedPlatforms,
    }),
    release_anchor_date: release.release_date,
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: phaseError } = await ctx.marketing.from("campaign_phases").insert({
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    campaign_id: campaign.id,
    code: "catalog-revival",
    name: "Catalog revival sprint",
    objective: "Turn proven catalog affinity into fresh listeners and follows",
    relative_start_days: 0,
    relative_end_days: 7,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    status: "active",
    sort_order: 0,
  });
  if (phaseError) throw new Error(phaseError.message);
  if (connectedPlatforms.length) {
    const moments = connectedPlatforms.flatMap((platform, platformIndex) => [
      {
        owner_id: ctx.user.id,
        artist_id: ctx.artist.artistId,
        release_id: release.id,
        campaign_id: campaign.id,
        title: `${release.title}: strongest hook rediscovery`,
        platform,
        format: platform === "YouTube Shorts" ? "Short" : "Short-form video",
        status: "Idea",
        goal: "Streams",
        scheduled_at: new Date(start.getTime() + (1 + platformIndex) * 86_400_000).toISOString(),
        hook_text: release.primary_hook || "Lead immediately with the strongest musical moment.",
        production_notes: "Catalog revival: use the existing musical proof point. Generate/refine creative only after approval; do not invent unrelated launch language.",
        source: "automation" as const,
        approval_status: "not_required" as const,
        content_angle: "rediscovery / strongest hook",
      },
      {
        owner_id: ctx.user.id,
        artist_id: ctx.artist.artistId,
        release_id: release.id,
        campaign_id: campaign.id,
        title: `${release.title}: world-building rediscovery`,
        platform,
        format: platform === "YouTube Shorts" ? "Short" : "Short-form video",
        status: "Idea",
        goal: "Streams",
        scheduled_at: new Date(start.getTime() + (4 + platformIndex) * 86_400_000).toISOString(),
        hook_text: release.core_emotion || `Reconnect the track to the ${ctx.artist.artistName} world instead of presenting it as old content.`,
        production_notes: "Second catalog hypothesis: context/world-building. Keep the same track and measurable destination; vary the reason to care.",
        source: "automation" as const,
        approval_status: "not_required" as const,
        content_angle: "rediscovery / artist world",
      },
    ]);
    const { error: contentError } = await ctx.marketing.from("content_items").insert(moments);
    if (contentError) throw new Error(contentError.message);
  }
  return campaign.id;
}

async function createWinnerDerivatives(ctx: GrowthActionContext, contentItemId: string) {
  const { data: original, error } = await ctx.marketing
    .from("content_items")
    .select("*")
    .eq("id", contentItemId)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId)
    .single();
  if (error) throw new Error(error.message);
  const now = Date.now();
  const rows = [1, 3, 5].map((days, index) => ({
    owner_id: ctx.user.id,
    artist_id: ctx.artist.artistId,
    release_id: original.release_id,
    campaign_id: original.campaign_id,
    phase_id: original.phase_id,
    experiment_id: original.experiment_id,
    title: `${original.title} · derivative ${index + 1}`,
    platform: original.platform,
    format: original.format,
    status: "Idea",
    goal: original.goal,
    scheduled_at: new Date(now + days * 86_400_000).toISOString(),
    hook_text: original.hook_text,
    cta: original.cta,
    production_notes: `Derivative of proven content ${original.id}. Preserve the winning premise; vary execution, opening frame or pacing instead of starting from a new concept.`,
    source: "automation" as const,
    approval_status: "not_required" as const,
    content_angle: `winner derivative ${index + 1}`,
  }));
  const { error: insertError } = await ctx.marketing.from("content_items").insert(rows);
  if (insertError) throw new Error(insertError.message);
}

export async function activateGrowthOpportunity(form: FormData) {
  const ctx = await getGrowthActionContext();
  const id = uuid.parse(value(form, "id"));
  const { data: opportunity, error } = await ctx.growth
    .from("growth_opportunities")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId)
    .single();
  if (error) throw new Error(error.message);
  if (opportunity.kind === "catalog_revival" && opportunity.release_id) {
    await createCatalogRevivalCampaign(ctx, opportunity.release_id, opportunity.id);
  } else if (opportunity.kind === "content_breakout" && opportunity.content_item_id) {
    await createWinnerDerivatives(ctx, opportunity.content_item_id);
  } else if (opportunity.kind === "funnel_bottleneck") {
    const action = opportunity.recommended_action && typeof opportunity.recommended_action === "object" && !Array.isArray(opportunity.recommended_action)
      ? String((opportunity.recommended_action as Record<string, Json>).action ?? opportunity.rationale)
      : opportunity.rationale;
    const { error: taskError } = await ctx.operational.from("tasks").insert({
      owner_id: ctx.user.id,
      artist_id: ctx.artist.artistId,
      title: `Growth bottleneck: ${opportunity.title}`,
      priority: "High",
      category: "growth" as never,
      metadata: json({ opportunityId: opportunity.id, action }) as never,
    } as never);
    if (taskError) throw new Error(taskError.message);
  }
  const { error: statusError } = await ctx.growth
    .from("growth_opportunities")
    .update({ status: "accepted" })
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId);
  if (statusError) throw new Error(statusError.message);
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
  revalidatePath("/studio/production");
  revalidatePath("/studio/campaigns");
}

export async function dismissGrowthOpportunity(form: FormData) {
  const ctx = await getGrowthActionContext();
  const id = uuid.parse(value(form, "id"));
  const { error } = await ctx.growth
    .from("growth_opportunities")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("artist_id", ctx.artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
}
