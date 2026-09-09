import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type {
  DjIntelligenceDatabase,
  DjPreferenceValues,
  DjProfileRow,
} from "@/types/dj-intelligence-database";

export const DEFAULT_DJ_PREFERENCES: DjPreferenceValues = {
  enabled: true,
  harmonicAdventure: 0.5,
  transitionAggressiveness: 0.5,
  exploration: 0.45,
  openingEnergy: 0.42,
  closingEnergy: 0.58,
};

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
    openingEnergy: clamp01(number(raw.openingEnergy, DEFAULT_DJ_PREFERENCES.openingEnergy)),
    closingEnergy: clamp01(number(raw.closingEnergy, DEFAULT_DJ_PREFERENCES.closingEnergy)),
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
    version: "ensemblis.dj-profile.v1",
    enabled: explicit.enabled,
    harmonic_adventure: boundedLearnedNudge(explicit.harmonicAdventure, learned.harmonicAdventure, confidence),
    transition_aggressiveness: boundedLearnedNudge(explicit.transitionAggressiveness, learned.transitionAggressiveness, confidence),
    exploration: boundedLearnedNudge(explicit.exploration, learned.exploration, confidence),
    opening_energy: boundedLearnedNudge(explicit.openingEnergy, learned.openingEnergy, confidence),
    closing_energy: boundedLearnedNudge(explicit.closingEnergy, learned.closingEnergy, confidence),
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

export function feedbackSignalFromPlan(value: unknown) {
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
  const energies = tracks
    .map((item) => number(item.energy, Number.NaN))
    .filter(Number.isFinite);
  const selection = record(plan.selection_summary);
  const candidateCount = Math.max(0, number(selection.candidate_count, tracks.length));
  const omittedCount = Math.max(0, number(selection.omitted_count, 0));
  const meanHarmonic = mean(harmonics, 0.78);
  const meanBars = mean(bars, 8);

  return {
    harmonicAdventure: clamp01((0.92 - meanHarmonic) / 0.5),
    transitionAggressiveness: clamp01((meanBars / 24) * 0.78 + creativeShare * 0.22),
    exploration: candidateCount > 0 ? clamp01(omittedCount / candidateCount + 0.35) : 0.45,
    openingEnergy: energies.length ? clamp01(energies[0]) : DEFAULT_DJ_PREFERENCES.openingEnergy,
    closingEnergy: energies.length ? clamp01(energies[energies.length - 1]) : DEFAULT_DJ_PREFERENCES.closingEnergy,
  } satisfies Omit<DjPreferenceValues, "enabled">;
}

export function json(value: unknown): Json {
  return value as Json;
}
