import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type {
  DjEvidenceType,
  DjIntelligenceDatabase,
  DjLibraryHistorySourceKind,
  DjPreferenceValues,
  DjProfileRow,
} from "@/types/dj-intelligence-database";

export const DEFAULT_DJ_PREFERENCES: DjPreferenceValues = {
  enabled: true,
  harmonicAdventure: 0.5,
  transitionAggressiveness: 0.5,
  exploration: 0.45,
  tempoMovement: 0.42,
  energyDynamics: 0.52,
};

export type DjPreferenceSignal = Omit<DjPreferenceValues, "enabled">;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampWeight(value: number) {
  return Math.max(0.05, Math.min(1, value));
}

function aggregationWeight(value: unknown) {
  return Math.max(0.001, Math.min(1, number(value, 1)));
}

export function asDjIntelligenceClient(
  client: SupabaseClient<Database> | SupabaseClient<DjIntelligenceDatabase>,
) {
  return client as unknown as SupabaseClient<DjIntelligenceDatabase>;
}

export function normalizeDjPreferences(value: unknown): DjPreferenceValues {
  const raw = record(value);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_DJ_PREFERENCES.enabled,
    harmonicAdventure: clamp01(number(raw.harmonicAdventure, DEFAULT_DJ_PREFERENCES.harmonicAdventure)),
    transitionAggressiveness: clamp01(number(raw.transitionAggressiveness, DEFAULT_DJ_PREFERENCES.transitionAggressiveness)),
    exploration: clamp01(number(raw.exploration, DEFAULT_DJ_PREFERENCES.exploration)),
    tempoMovement: clamp01(number(raw.tempoMovement, DEFAULT_DJ_PREFERENCES.tempoMovement)),
    energyDynamics: clamp01(number(raw.energyDynamics, DEFAULT_DJ_PREFERENCES.energyDynamics)),
  };
}

function boundedLearnedNudge(explicit: number, learned: number, confidence: number) {
  // Learned evidence may move an explicit setting by at most ±8 percentage points.
  // It can never override a user's direct preference or any hard planner constraint.
  return clamp01(explicit + (learned - 0.5) * 0.16 * clamp01(confidence));
}

export function plannerDjProfile(row: DjProfileRow | null | undefined) {
  const explicit = normalizeDjPreferences(row?.explicit_preferences);
  const learned = normalizeDjPreferences(row?.learned_preferences);
  const confidence = clamp01(number(row?.learned_confidence, 0));
  return {
    version: "ensemblis.dj-profile.v2",
    enabled: explicit.enabled,
    harmonic_adventure: boundedLearnedNudge(explicit.harmonicAdventure, learned.harmonicAdventure, confidence),
    transition_aggressiveness: boundedLearnedNudge(explicit.transitionAggressiveness, learned.transitionAggressiveness, confidence),
    exploration: boundedLearnedNudge(explicit.exploration, learned.exploration, confidence),
    tempo_movement: boundedLearnedNudge(explicit.tempoMovement, learned.tempoMovement, confidence),
    energy_dynamics: boundedLearnedNudge(explicit.energyDynamics, learned.energyDynamics, confidence),
    learned_confidence: confidence,
    evidence_count: row?.evidence_count ?? 0,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

function mean(values: number[], fallback: number) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function adjacentRatios(values: number[]) {
  const result: number[] = [];
  for (let index = 0; index < values.length - 1; index += 1) {
    const a = Math.max(1e-6, values[index]);
    result.push(Math.abs(values[index + 1] - values[index]) / a);
  }
  return result;
}

function adjacentAbsoluteDeltas(values: number[]) {
  const result: number[] = [];
  for (let index = 0; index < values.length - 1; index += 1) {
    result.push(Math.abs(values[index + 1] - values[index]));
  }
  return result;
}

function transitionAggressivenessForTechnique(value: unknown) {
  return {
    drop_cut: 0.16,
    echo_out: 0.28,
    quick_mix: 0.40,
    bass_swap: 0.62,
    harmonic_blend: 0.82,
    breakdown_swap: 0.90,
  }[String(value)] ?? 0.5;
}

export function feedbackSignalFromPlan(value: unknown): DjPreferenceSignal {
  const plan = record(value);
  const transitions = records(plan.transitions);
  const tracks = records(plan.tracks);
  const harmonics = transitions
    .map((item) => number(record(item.metrics).harmonic, Number.NaN))
    .filter(Number.isFinite);
  const bars = transitions
    .map((item) => number(item.bars, 0))
    .filter(Number.isFinite);
  const creativeShare = transitions.length
    ? transitions.filter((item) => ["harmonic_blend", "breakdown_swap"].includes(String(item.technique ?? ""))).length / transitions.length
    : 0;
  const selection = record(plan.selection_summary);
  const candidateCount = Math.max(0, number(selection.candidate_count, tracks.length));
  const omittedCount = Math.max(0, number(selection.omitted_count, 0));
  const playbackBpms = tracks
    .map((item) => number(item.playback_bpm ?? item.dj_bpm ?? item.source_bpm, Number.NaN))
    .filter(Number.isFinite);
  const energies = tracks
    .map((item) => number(item.energy, Number.NaN))
    .filter(Number.isFinite);
  const meanHarmonic = mean(harmonics, 0.78);
  const meanBars = mean(bars, 8);
  const tempoDeltas = adjacentRatios(playbackBpms);
  const energyDeltas = adjacentAbsoluteDeltas(energies);

  return {
    harmonicAdventure: clamp01((0.92 - meanHarmonic) / 0.5),
    transitionAggressiveness: clamp01((meanBars / 24) * 0.78 + creativeShare * 0.22),
    exploration: candidateCount > 0 ? clamp01(omittedCount / candidateCount + 0.35) : DEFAULT_DJ_PREFERENCES.exploration,
    tempoMovement: tempoDeltas.length
      ? clamp01(mean(tempoDeltas, 0) / 0.12)
      : DEFAULT_DJ_PREFERENCES.tempoMovement,
    energyDynamics: energyDeltas.length
      ? clamp01(mean(energyDeltas, 0) / 0.42)
      : DEFAULT_DJ_PREFERENCES.energyDynamics,
  };
}

export function feedbackSignalFromEdit(operation: string, value: unknown) {
  const plan = record(value);
  const signal = feedbackSignalFromPlan(plan);
  const transitions = records(plan.transitions);
  const overridden = transitions.filter((item) => item.user_override === true);

  if (operation === "override_transition" && overridden.length) {
    signal.transitionAggressiveness = clamp01(mean(
      overridden.map((item) => transitionAggressivenessForTechnique(item.technique)),
      signal.transitionAggressiveness,
    ));
    const harmonics = overridden
      .map((item) => number(record(item.metrics).harmonic, Number.NaN))
      .filter(Number.isFinite);
    if (harmonics.length) {
      signal.harmonicAdventure = clamp01((0.92 - mean(harmonics, 0.78)) / 0.5);
    }
  }

  const weight = clampWeight({
    reorder_and_lock: 0.78,
    replace_track: 0.72,
    exclude_track: 0.64,
    override_transition: 0.88,
    reset_transition: 0.52,
  }[operation] ?? 0.5);

  return { signal, weight };
}

const SIGNAL_KEYS: Array<keyof DjPreferenceSignal> = [
  "harmonicAdventure",
  "transitionAggressiveness",
  "exploration",
  "tempoMovement",
  "energyDynamics",
];

function weightedLearnedPreferences(rows: Array<{ signal: unknown; weight: unknown; verdict: unknown }>) {
  const accepted = rows.filter((row) => row.verdict === "accepted");
  const result = { ...DEFAULT_DJ_PREFERENCES };
  let totalWeight = 0;

  for (const key of SIGNAL_KEYS) {
    let weighted = 0;
    let weightSum = 0;
    for (const row of accepted) {
      const signal = record(row.signal);
      const sample = signal[key];
      if (typeof sample !== "number" || !Number.isFinite(sample)) continue;
      const weight = aggregationWeight(row.weight);
      weighted += clamp01(sample) * weight;
      weightSum += weight;
    }
    result[key] = weightSum > 0 ? clamp01(weighted / weightSum) : DEFAULT_DJ_PREFERENCES[key];
    totalWeight = Math.max(totalWeight, weightSum);
  }

  // Confidence grows with meaningful accepted evidence, not raw click count. Even a large history
  // remains capped at 0.6, and plannerDjProfile applies an additional ±8-point nudge ceiling.
  const learnedConfidence = clamp01(Math.min(0.6, 0.6 * (1 - Math.exp(-totalWeight / 6))));
  return { learned: result, learnedConfidence };
}

function boundedLibraryHistoryRows(rows: Array<{ signal: unknown; weight: unknown }>) {
  const capped = rows.map((row) => ({
    signal: row.signal,
    weight: Math.min(0.4, aggregationWeight(row.weight)),
    verdict: "accepted" as const,
  }));
  const total = capped.reduce((sum, row) => sum + row.weight, 0);
  // Imported play history is observational and incomplete. Across every library revision combined,
  // it may contribute at most 1.5 aggregate evidence weight before the global confidence cap.
  const scale = total > 1.5 ? 1.5 / total : 1;
  return capped.map((row) => ({ ...row, weight: row.weight * scale }));
}

export async function recalculateDjProfile(
  client: SupabaseClient<Database> | SupabaseClient<DjIntelligenceDatabase>,
  ownerId: string,
  artistId: string,
) {
  const db = asDjIntelligenceClient(client);
  const [evidence, libraryHistory, current] = await Promise.all([
    db.from("dj_preference_evidence")
      .select("verdict,signal,weight")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .order("created_at", { ascending: false })
      .limit(300),
    db.from("dj_library_history_evidence")
      .select("signal,weight")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("dj_profiles")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .maybeSingle(),
  ]);
  if (evidence.error) throw new Error(evidence.error.message);
  if (libraryHistory.error) throw new Error(libraryHistory.error.message);
  if (current.error) throw new Error(current.error.message);

  const deliberateRows = evidence.data ?? [];
  const historyRows = boundedLibraryHistoryRows(libraryHistory.data ?? []);
  const rows = [...deliberateRows, ...historyRows];
  const { learned, learnedConfidence } = weightedLearnedPreferences(rows);
  const saved = await db.from("dj_profiles").upsert({
    owner_id: ownerId,
    artist_id: artistId,
    explicit_preferences: current.data?.explicit_preferences ?? json(normalizeDjPreferences({})),
    learned_preferences: json(learned),
    learned_confidence: learnedConfidence,
    evidence_count: rows.length,
    profile_version: 2,
  }, { onConflict: "owner_id,artist_id" }).select("*").single();
  if (saved.error) throw new Error(saved.error.message);
  return saved.data;
}

export async function recordDjPreferenceEvidence({
  client,
  ownerId,
  artistId,
  jobId,
  evidenceType,
  evidenceKey,
  verdict = "accepted",
  signal,
  weight,
}: {
  client: SupabaseClient<Database> | SupabaseClient<DjIntelligenceDatabase>;
  ownerId: string;
  artistId: string;
  jobId: string;
  evidenceType: DjEvidenceType;
  evidenceKey: string;
  verdict?: "accepted" | "rejected";
  signal: DjPreferenceSignal;
  weight: number;
}) {
  const db = asDjIntelligenceClient(client);
  const evidence = await db.from("dj_preference_evidence").upsert({
    owner_id: ownerId,
    artist_id: artistId,
    automix_job_id: jobId,
    evidence_type: evidenceType,
    evidence_key: evidenceKey.slice(0, 120),
    verdict,
    signal: json(signal),
    weight: clampWeight(weight),
  }, { onConflict: "owner_id,artist_id,automix_job_id,evidence_type,evidence_key" }).select("*").single();
  if (evidence.error) throw new Error(evidence.error.message);
  const profile = await recalculateDjProfile(client, ownerId, artistId);
  return { evidence: evidence.data, profile };
}

export async function recordDjLibraryHistoryEvidence({
  client,
  ownerId,
  artistId,
  sourceKind,
  sourceId,
  sourceRevision,
  evidenceKey,
  signal,
  weight,
  sampleCount,
}: {
  client: SupabaseClient<Database> | SupabaseClient<DjIntelligenceDatabase>;
  ownerId: string;
  artistId: string;
  sourceKind: DjLibraryHistorySourceKind;
  sourceId: string;
  sourceRevision: string;
  evidenceKey: string;
  signal: DjPreferenceSignal;
  weight: number;
  sampleCount: number;
}) {
  const cleanSourceId = sourceId.trim().slice(0, 160);
  const cleanRevision = sourceRevision.trim().slice(0, 200);
  const cleanKey = evidenceKey.trim().slice(0, 160);
  if (!cleanSourceId || !cleanRevision || !cleanKey) throw new Error("DJ library history evidence requires source identity and revision.");
  const db = asDjIntelligenceClient(client);
  const evidence = await db.from("dj_library_history_evidence").upsert({
    owner_id: ownerId,
    artist_id: artistId,
    source_kind: sourceKind,
    source_id: cleanSourceId,
    source_revision: cleanRevision,
    evidence_key: cleanKey,
    signal: json(signal),
    weight: Math.min(0.4, clampWeight(weight)),
    sample_count: Math.max(0, Math.round(sampleCount)),
  }, { onConflict: "owner_id,artist_id,source_kind,source_id,source_revision,evidence_key" }).select("*").single();
  if (evidence.error) throw new Error(evidence.error.message);
  const profile = await recalculateDjProfile(client, ownerId, artistId);
  return { evidence: evidence.data, profile };
}

export function json(value: unknown): Json {
  return value as Json;
}
