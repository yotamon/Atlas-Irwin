import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { normalizeArtistPerformance, type ArtistPerformanceInput, type MarketingMomentInput } from "@/lib/marketing/marketing-intelligence";
import { aggregateMetrics, formatRate, objectivePerformanceScore, primarySignalValue } from "@/lib/marketing/domain";
import type { CampaignPlanningContext } from "@/lib/marketing/planner";
import { resolveActiveArtistContext, resolveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { asMomentAwareMarketingClient, asMomentsClient } from "@/lib/studio/moments-db";
import type { Json } from "@/types/database";

export const uuid = z.uuid();

export function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export function json(input: unknown) { return input as Json; }

export function record(input: Json | unknown): Record<string, Json | undefined> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, Json | undefined> : {};
}

export function stringValue(input: Json | undefined) { return typeof input === "string" ? input.trim() : ""; }

export function brandRowText(section: string, content: Json) {
  const row = record(content);
  const text = stringValue(row.text);
  if (text) return `${section}: ${text}`;
  const raw = JSON.stringify(content);
  return raw && raw !== "{}" ? `${section}: ${raw}` : "";
}

export function attributionCode() { return `ei_${randomBytes(7).toString("base64url")}`; }

export async function actionContext(form?: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = form ? value(form, "artist_id") : "";
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, uuid.parse(requestedArtistId))
    : await resolveActiveArtistContext(supabase, user);
  return {
    supabase, user, artist,
    marketing: asMarketingClient(supabase),
    momentMarketing: asMomentAwareMarketingClient(supabase),
    moments: asMomentsClient(supabase),
    music: asArtistScopedMusicClient(supabase),
    operational: asArtistScopedOperationalClient(supabase),
  };
}

export function rejectionSignals(events: Array<{ payload: Json }>) {
  return events.flatMap((event) => {
    const payload = record(event.payload);
    const label = stringValue(payload.reasonLabel) || stringValue(payload.reason);
    const notes = stringValue(payload.notes);
    const signal = [label, notes].filter(Boolean).join(": ");
    return signal ? [signal] : [];
  }).slice(0, 30);
}

export function marketingMoment(row: {
  id: string; label: string; moment_type: string; start_ms: number; end_ms: number;
  source_mode: "audio" | "lyrics" | "stems" | "fused"; purpose_tags: string[];
  energy_score: number | null; hook_score: number | null; emotional_score: number | null;
  vocal_score: number | null; uniqueness_score: number | null; confidence: number; state: "approved";
}): MarketingMomentInput {
  return {
    id: row.id, label: row.label, momentType: row.moment_type, startMs: row.start_ms, endMs: row.end_ms,
    sourceMode: row.source_mode, purposeTags: row.purpose_tags, energyScore: row.energy_score, hookScore: row.hook_score,
    emotionalScore: row.emotional_score, vocalScore: row.vocal_score, uniquenessScore: row.uniqueness_score,
    confidence: row.confidence, state: row.state, audioSceneId: null,
  };
}

export function observedPerformance(
  content: Array<{ id: string; title: string; platform: string; format: string; goal: string }>,
  metrics: Array<Record<string, unknown>>,
) {
  const history: ArtistPerformanceInput[] = [];
  const plannerSummary: CampaignPlanningContext["performanceSummary"] = [];
  for (const item of content) {
    const rows = metrics.filter((metric) => metric.content_item_id === item.id);
    if (!rows.length) continue;
    const aggregate = aggregateMetrics(rows);
    const score = objectivePerformanceScore(item.goal, aggregate);
    if (score <= 0) continue;
    const primary = primarySignalValue(item.goal, aggregate);
    const signal = item.goal === "Reach" ? `${Math.round(primary)} reach` : formatRate(primary);
    history.push({ title: item.title, platform: item.platform, format: item.format, goal: item.goal, score, signal });
    plannerSummary.push({ title: item.title, platform: item.platform, format: item.format, goal: item.goal, score, signal });
  }
  return { normalized: normalizeArtistPerformance(history), plannerSummary: plannerSummary.sort((a,b) => b.score-a.score).slice(0,12) };
}

export function previousCreativeRows(
  content: Array<{ campaign_id: string | null; status: string; title: string; platform: string; format: string; content_angle: string | null; hook_text: string | null; caption: string | null }>,
  campaignId: string,
) {
  return content.filter((item) => item.campaign_id !== campaignId || item.status === "Published").map((item) => ({
    title: item.title, platform: item.platform, format: item.format, contentAngle: item.content_angle, hookText: item.hook_text, caption: item.caption,
  })).slice(-120);
}
