import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadArtistCreativeMemory } from "@/lib/creative-memory/server";
import { asMarketingClient } from "@/lib/marketing/db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import type { Database } from "@/types/database";
import {
  artistMemoryForConsumer,
  brandSettingMemoryItem,
  creativePreferenceMemoryItems,
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

export async function loadArtistMemory(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
}): Promise<ArtistMemorySnapshot> {
  const operational = asArtistScopedOperationalClient(input.db);
  const marketing = asMarketingClient(input.db);
  const [brandResult, learningsResult, creativeMemory] = await Promise.all([
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
  ]);

  const firstError = brandResult.error ?? learningsResult.error;
  if (firstError) throw new Error(firstError.message);

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