import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadArtistCreativeMemory } from "@/lib/creative-memory/server";
import { asMarketingClient } from "@/lib/marketing/db";
import { latestExactCalibrationByMoment } from "@/lib/studio/moment-calibration";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import type { Database } from "@/types/database";
import type { Moment, MomentCalibrationEvent } from "@/types/moments-database";
import {
  artistMemoryForConsumer,
  brandSettingMemoryItem,
  creativePreferenceMemoryItems,
  momentCalibrationMemoryItem,
  summarizeArtistMemory,
  verifiedLearningMemoryItem,
  type ArtistMemoryConsumer,
  type ArtistMemoryItem,
  type ArtistMemorySnapshot,
} from "./domain";

type DatabaseClient = SupabaseClient<Database>;

type BrandSettingRow = {
  id: string;
  section: string;
  content: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

type LearningRow = {
  id: string;
  scope: string;
  finding: string;
  confidence: number;
  status: string;
  source?: string | null;
  evidence_sample_size?: number | null;
  evidence_window_end?: string | null;
  expires_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function brandText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function expiredAt(expiresAt: string | null | undefined, now: number) {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= now;
}

function missingCalibrationTable(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function loadArtistMemory(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
}): Promise<ArtistMemorySnapshot> {
  const operational = asArtistScopedOperationalClient(input.db);
  const marketing = asMarketingClient(input.db);
  const moments = asMomentsClient(input.db);
  const [brandResult, learningsResult, creativeMemory, calibrationResult] = await Promise.all([
    operational
      .from("brand_settings")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId),
    marketing
      .from("marketing_learnings")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100),
    loadArtistCreativeMemory({
      db: input.db,
      ownerId: input.ownerId,
      artistId: input.artistId,
      recommendationLimit: 8,
    }),
    moments
      .from("moment_calibration_events")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const firstError = brandResult.error ?? learningsResult.error;
  if (firstError) throw new Error(firstError.message);
  if (calibrationResult.error && !missingCalibrationTable(calibrationResult.error)) {
    throw new Error(calibrationResult.error.message);
  }

  const items: ArtistMemoryItem[] = [];
  for (const row of (brandResult.data ?? []) as unknown as BrandSettingRow[]) {
    const memory = brandSettingMemoryItem({
      id: row.id,
      section: row.section,
      text: brandText(row.content),
      updatedAt: row.updated_at ?? row.created_at ?? null,
    });
    if (memory) items.push(memory);
  }

  items.push(...creativePreferenceMemoryItems({
    positive: creativeMemory.preferences.positive,
    negative: creativeMemory.preferences.negative,
    evidenceCount: creativeMemory.eventCount,
  }));

  const calibrationEvents = calibrationResult.error
    ? []
    : (calibrationResult.data ?? []) as unknown as MomentCalibrationEvent[];
  if (calibrationEvents.length) {
    const referencedMomentIds = [...new Set(calibrationEvents.flatMap((event) => [
      event.moment_id,
      ...(event.preferred_moment_id ? [event.preferred_moment_id] : []),
    ]))];
    const { data: momentRows, error: momentError } = await moments
      .from("moments")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .in("id", referencedMomentIds);
    if (momentError) throw new Error(momentError.message);
    const currentMoments = (momentRows ?? []) as unknown as Moment[];
    const momentMap = new Map(currentMoments.map((moment) => [moment.id, moment]));
    const latest = latestExactCalibrationByMoment(currentMoments, calibrationEvents);
    for (const event of [...latest.values()].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)).slice(0, 12)) {
      const moment = momentMap.get(event.moment_id);
      if (!moment || moment.state === "superseded") continue;
      const preferred = event.preferred_moment_id ? momentMap.get(event.preferred_moment_id) : null;
      items.push(momentCalibrationMemoryItem({
        eventId: event.id,
        releaseId: event.release_id,
        momentLabel: moment.label,
        judgment: event.judgment,
        correctedPurpose: event.corrected_purpose,
        preferredCutSeconds: event.preferred_cut_seconds,
        preferredMomentLabel: preferred?.label ?? null,
        observedAt: event.created_at,
      }));
    }
  }

  const now = Date.now();
  for (const row of (learningsResult.data ?? []) as unknown as LearningRow[]) {
    const memory = verifiedLearningMemoryItem({
      id: row.id,
      scope: row.scope,
      finding: row.finding,
      confidence: Number(row.confidence),
      sampleSize: row.evidence_sample_size ?? null,
      source: row.source ?? null,
      observedAt: row.evidence_window_end ?? row.updated_at ?? row.created_at ?? null,
      expiresAt: row.expires_at ?? null,
      expired: expiredAt(row.expires_at, now),
    });
    if (memory) items.push(memory);
  }

  const classOrder = {
    identity: 0,
    creative_rule: 1,
    preference_evidence: 2,
    performance_learning: 3,
    strategic_constraint: 4,
    provenance_compliance: 5,
  } as const;

  items.sort((left, right) => {
    const lifecycle = Number(left.lifecycle !== "active") - Number(right.lifecycle !== "active");
    if (lifecycle) return lifecycle;
    const classDelta = classOrder[left.class] - classOrder[right.class];
    if (classDelta) return classDelta;
    return right.confidence.score - left.confidence.score || left.title.localeCompare(right.title);
  });

  return summarizeArtistMemory(items);
}

export async function loadArtistMemoryForConsumer(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
  consumer: ArtistMemoryConsumer;
}) {
  const snapshot = await loadArtistMemory(input);
  return artistMemoryForConsumer(snapshot, input.consumer);
}

export function artistMemoryBrief(items: ArtistMemoryItem[], maxCharacters = 2_400) {
  const lines: string[] = [];
  let length = 0;
  for (const item of items) {
    const line = `[${item.confidence.label}/${item.class}] ${item.title}: ${item.value}`;
    if (length + line.length > maxCharacters) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}
