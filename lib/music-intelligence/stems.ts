import type { Json } from "@/types/database";
import type { AudioSceneType, StemCategory, TrackStem } from "@/types/stem-database";

export const STEM_CATEGORIES: readonly StemCategory[] = [
  "vocals",
  "drums",
  "bass",
  "percussion",
  "guitar",
  "keys",
  "synth",
  "strings",
  "brass",
  "woodwinds",
  "fx",
  "other",
] as const;

export const STEM_CATEGORY_LABELS: Record<StemCategory, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  percussion: "Percussion",
  guitar: "Guitar",
  keys: "Keys / Rhodes / Piano",
  synth: "Synths / Pads",
  strings: "Strings",
  brass: "Brass",
  woodwinds: "Woodwinds",
  fx: "FX / Atmosphere",
  other: "Other",
};

const CATEGORY_PATTERNS: Array<[StemCategory, RegExp]> = [
  ["vocals", /(?:^|[\s_.-])(vocal|vocals|vox|voice|leadvox|lead-vocal|backing-vocal|bgv|acapella)(?:$|[\s_.-])/i],
  ["drums", /(?:^|[\s_.-])(drum|drums|kit|kick|snare|hihat|hi-hat|cymbal|clap)(?:$|[\s_.-])/i],
  ["bass", /(?:^|[\s_.-])(bass|sub|subbass|sub-bass)(?:$|[\s_.-])/i],
  ["percussion", /(?:^|[\s_.-])(perc|percussion|conga|bongo|shaker|tambourine|clave)(?:$|[\s_.-])/i],
  ["guitar", /(?:^|[\s_.-])(guitar|gtr|rhythm-guitar|lead-guitar)(?:$|[\s_.-])/i],
  ["keys", /(?:^|[\s_.-])(keys|keyboard|piano|rhodes|organ|clav|wurlitzer|wurli)(?:$|[\s_.-])/i],
  ["synth", /(?:^|[\s_.-])(synth|synths|pad|pads|lead|arp|arpeggio|pluck)(?:$|[\s_.-])/i],
  ["strings", /(?:^|[\s_.-])(strings|violin|viola|cello|orchestra)(?:$|[\s_.-])/i],
  ["brass", /(?:^|[\s_.-])(brass|horn|horns|trumpet|trombone)(?:$|[\s_.-])/i],
  ["woodwinds", /(?:^|[\s_.-])(woodwind|flute|sax|saxophone|clarinet|oboe)(?:$|[\s_.-])/i],
  ["fx", /(?:^|[\s_.-])(fx|sfx|effects|atmos|atmosphere|ambience|noise|riser|sweep|impact)(?:$|[\s_.-])/i],
];

export function inferStemCategory(filename: string): StemCategory {
  const normalized = filename.replace(/\.[^.]+$/, "").replace(/[()\[\]]/g, " ");
  return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(` ${normalized} `))?.[0] ?? "other";
}

export function cleanStemLabel(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Stem";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function stemMetric(stem: TrackStem, key: string, fallback = 0) {
  const analysis = record(stem.analysis);
  const summary = record(analysis.summary);
  const metrics = record(analysis.role_metrics);
  const legacyMetrics = record(analysis.metrics);
  const direct = analysis[key];
  if (typeof direct === "number") return clamp01(direct);
  if (typeof summary[key] === "number") return clamp01(summary[key] as number);
  if (typeof metrics[key] === "number") return clamp01(metrics[key] as number);
  if (typeof legacyMetrics[key] === "number") return clamp01(legacyMetrics[key] as number);
  return fallback;
}

export function stemCapabilityScore(stem: TrackStem) {
  const energy = stemMetric(stem, "energy", 0.5);
  const hook = stemMetric(stem, "hook_score", stemMetric(stem, "salience", 0.5));
  const groove = stemMetric(stem, "groove_score", 0.35);
  const loopability = stemMetric(stem, "loopability", 0.5);
  const activeRatio = stemMetric(stem, "active_ratio", 0.5);
  const roleWeights = stem.category === "vocals"
    ? { energy: 0.14, hook: 0.46, groove: 0.04, loop: 0.14, active: 0.22 }
    : ["drums", "bass", "percussion"].includes(stem.category)
      ? { energy: 0.17, hook: 0.28, groove: 0.30, loop: 0.12, active: 0.13 }
      : { energy: 0.18, hook: 0.36, groove: 0.08, loop: 0.18, active: 0.20 };
  return clamp01(
    energy * roleWeights.energy
    + hook * roleWeights.hook
    + groove * roleWeights.groove
    + loopability * roleWeights.loop
    + activeRatio * roleWeights.active,
  );
}

function ranked(stems: TrackStem[], categories?: StemCategory[]) {
  return stems
    .filter((stem) => stem.status === "ready" && (!categories || categories.includes(stem.category)))
    .sort((a, b) => stemCapabilityScore(b) - stemCapabilityScore(a));
}

type Window = { startMs: number; endMs: number; score: number; provenance?: string };

function readWindow(value: unknown, provenance?: string): Window | null {
  const row = record(value);
  const startMs = number(row.start_ms, Number.NaN);
  const endMs = number(row.end_ms, Number.NaN);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, score: clamp01(number(row.score, 0.7)), provenance };
}

function overlapRatio(a: Window, b: Window) {
  const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  return overlap / Math.max(1, Math.min(a.endMs - a.startMs, b.endMs - b.startMs));
}

function stemMomentWindows(stem: TrackStem) {
  const analysis = record(stem.analysis);
  return (Array.isArray(analysis.best_moments) ? analysis.best_moments : [])
    .map((value) => readWindow(value, `stem:${stem.id}`))
    .filter((value): value is Window => Boolean(value));
}

function stemWindowEvidence(stems: TrackStem[], candidate: Window) {
  if (!stems.length) return 0.5;
  const scores = stems.map((stem) => {
    const moments = stemMomentWindows(stem);
    const momentEvidence = moments.reduce(
      (best, moment) => Math.max(best, overlapRatio(candidate, moment) * moment.score),
      0,
    );
    const analysis = record(stem.analysis);
    const sections = Array.isArray(analysis.section_activity) ? analysis.section_activity : [];
    const sectionEvidence = sections.reduce((best, raw) => {
      const row = record(raw);
      const window = readWindow({ ...row, score: number(row.active_ratio, 0) * 0.45 + number(row.energy, 0) * 0.35 + number(row.rhythmic_activity, 0) * 0.2 });
      return window ? Math.max(best, overlapRatio(candidate, window) * window.score) : best;
    }, 0);
    return clamp01(Math.max(momentEvidence, sectionEvidence) * 0.82 + stemCapabilityScore(stem) * 0.18);
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function gridPoints(musicMap: Json | null | undefined, key: "downbeats_ms" | "beats_ms") {
  const map = record(musicMap);
  return Array.isArray(map[key])
    ? map[key].filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b)
    : [];
}

function nearestPoint(target: number, points: number[], min: number, max: number) {
  const candidates = points.filter((point) => point >= min && point <= max);
  if (!candidates.length) return Math.max(min, Math.min(max, target));
  return candidates.reduce((best, point) => Math.abs(point - target) < Math.abs(best - target) ? point : best, candidates[0]);
}

function snapWindow(window: Window, musicMap: Json | null | undefined, preferredMs: number): Window {
  const downbeats = gridPoints(musicMap, "downbeats_ms");
  const beats = gridPoints(musicMap, "beats_ms");
  const grid = downbeats.length ? downbeats : beats;
  if (!grid.length) return window;
  const durationMs = number(record(musicMap).duration_ms, Math.max(window.endMs, preferredMs));
  const desired = Math.max(3000, preferredMs || window.endMs - window.startMs);
  const start = nearestPoint(window.startMs, grid, 0, Math.max(0, durationMs - 1000));
  const endTarget = Math.min(durationMs, start + desired);
  const end = nearestPoint(endTarget, grid, start + Math.min(1500, desired / 3), durationMs);
  return { ...window, startMs: start, endMs: Math.max(start + 1, end) };
}

function candidateWindow(
  musicMap: Json | null | undefined,
  intent: string,
  preferredMs = 15000,
  stems: TrackStem[] = [],
) {
  const map = record(musicMap);
  const candidates: Window[] = [];

  // Intent comes first. The previous implementation consulted the generic 15s social cut
  // first, which forced nearly every Audio Scene onto the exact same window.
  const moments = record(map.moments);
  const intentMoments = moments[intent];
  if (Array.isArray(intentMoments)) {
    for (const moment of intentMoments) {
      const direct = readWindow(moment, `music:${intent}`);
      if (direct) candidates.push(direct);
      const candidateId = record(moment).candidate_id;
      if (typeof candidateId === "string" && Array.isArray(map.hook_candidates)) {
        const match = map.hook_candidates.find((item) => record(item).id === candidateId);
        const matched = readWindow(match, `hook:${candidateId}`);
        if (matched) candidates.push(matched);
      }
    }
  }

  for (const stem of stems) candidates.push(...stemMomentWindows(stem));

  const socialCuts = record(map.social_cuts);
  const targetKey = String(Math.round(preferredMs / 1000));
  for (const key of [targetKey, "15", "8", "30", "6", "15s", "hook_15"]) {
    const window = readWindow(socialCuts[key], `social:${key}`);
    if (window) candidates.push(window);
  }

  if (Array.isArray(map.hook_candidates)) {
    for (const item of map.hook_candidates) {
      const window = readWindow(item, "hook");
      if (window) candidates.push(window);
    }
  }

  const durationMs = number(map.duration_ms, 0);
  if (!candidates.length) {
    const endMs = durationMs ? Math.min(durationMs, preferredMs) : preferredMs;
    return { startMs: 0, endMs, score: 0.45, provenance: "fallback" };
  }

  const deduped = candidates.filter((candidate, index, values) => values.findIndex(
    (other) => Math.abs(other.startMs - candidate.startMs) < 800 && Math.abs(other.endMs - candidate.endMs) < 1200,
  ) === index);
  const rankedCandidates = deduped.map((candidate) => {
    const stemEvidence = stemWindowEvidence(stems, candidate);
    const durationFit = clamp01(1 - Math.abs((candidate.endMs - candidate.startMs) - preferredMs) / Math.max(preferredMs, 1));
    const intentBonus = candidate.provenance === `music:${intent}` || candidate.provenance?.startsWith("hook:") ? 0.12 : 0;
    const score = clamp01(candidate.score * 0.42 + stemEvidence * 0.43 + durationFit * 0.15 + intentBonus);
    return { ...candidate, score };
  }).sort((a, b) => b.score - a.score);

  return snapWindow(rankedCandidates[0], musicMap, preferredMs);
}

export type AudioSceneDraft = {
  name: string;
  sceneType: AudioSceneType;
  description: string;
  objectiveTags: string[];
  platformHints: string[];
  recommendedStartMs: number;
  recommendedEndMs: number;
  score: number;
  rationale: Json;
  recipe: Json;
};

type Layer = {
  source: "stem" | "master";
  stem_id?: string;
  category?: StemCategory;
  gain_db: number;
  start_at_ms?: number;
  end_at_ms?: number;
  fade_in_ms?: number;
  fade_out_ms?: number;
};

function sceneRecipe(layers: Layer[], extras: Record<string, Json> = {}): Json {
  return {
    schema: "atlas.audio_scene.v1",
    mix_mode: "layers",
    layers: layers as unknown as Json,
    limiter: { enabled: true, ceiling_db: -1 },
    ...extras,
  };
}

function stemLayer(stem: TrackStem, gainDb = 0): Layer {
  return { source: "stem", stem_id: stem.id, category: stem.category, gain_db: gainDb };
}

function avgScore(stems: TrackStem[], fallback = 0.55) {
  if (!stems.length) return fallback;
  return clamp01(stems.reduce((sum, stem) => sum + stemCapabilityScore(stem), 0) / stems.length);
}

function snappedTransitionMs(musicMap: Json | null | undefined, window: Window, fraction = 0.3) {
  const downbeats = gridPoints(musicMap, "downbeats_ms");
  const beats = gridPoints(musicMap, "beats_ms");
  const grid = downbeats.length ? downbeats : beats;
  const min = window.startMs + Math.min(1800, (window.endMs - window.startMs) * 0.2);
  const max = window.endMs - Math.min(1500, (window.endMs - window.startMs) * 0.18);
  const target = window.startMs + (window.endMs - window.startMs) * fraction;
  const absolute = nearestPoint(target, grid, min, Math.max(min, max));
  return Math.max(250, Math.round(absolute - window.startMs));
}

export function buildSmartAudioScenes(stems: TrackStem[], musicMap?: Json | null): AudioSceneDraft[] {
  const ready = ranked(stems);
  if (!ready.length) return [];

  const vocals = ranked(ready, ["vocals"]);
  const rhythm = ranked(ready, ["drums", "bass", "percussion"]);
  const atmosphere = ranked(ready, ["synth", "keys", "strings", "fx"]);
  const melodic = ranked(ready, ["guitar", "keys", "synth", "strings", "brass", "woodwinds", "other"]);
  const nonVocals = ready.filter((stem) => stem.category !== "vocals");
  const instantHook = candidateWindow(musicMap, "instant_hook", 15000, vocals.length ? vocals : ready.slice(0, 2));
  const grooveWindow = candidateWindow(musicMap, "groove_loop", 15000, rhythm);
  const climax = candidateWindow(musicMap, "climax", 15000, ready.slice(0, 4));
  const story = candidateWindow(musicMap, "story_arc", 30000, atmosphere.length ? atmosphere : nonVocals.slice(0, 3));
  const result: AudioSceneDraft[] = [];

  if (vocals.length) {
    const supporting = atmosphere.slice(0, 2);
    const used = [...vocals, ...supporting];
    const vocalWindow = candidateWindow(musicMap, "musical_identity", 15000, vocals);
    const strongestVocalHook = Math.max(...vocals.map((stem) => stemMetric(stem, "hook_score", 0.7)));
    result.push({
      name: "Vocal Spotlight",
      sceneType: "vocal_spotlight",
      description: "The complete vocal stack in front, with only enough atmosphere to preserve the release world.",
      objectiveTags: ["lyrics", "identity", "intimacy", "story"],
      platformHints: ["story", "reel", "tiktok"],
      recommendedStartMs: vocalWindow.startMs,
      recommendedEndMs: vocalWindow.endMs,
      score: clamp01(avgScore(used) * 0.65 + strongestVocalHook * 0.2 + vocalWindow.score * 0.15),
      rationale: {
        vocal_stem_ids: vocals.map((stem) => stem.id) as unknown as Json,
        selected_window_provenance: vocalWindow.provenance ?? null,
        reason: "Uses the strongest vocal-specific window and keeps every ready vocal stem together so lead, backing vocals, doubles and harmonies remain musically complete.",
      },
      recipe: sceneRecipe([
        ...vocals.map((stem) => stemLayer(stem, 0)),
        ...supporting.map((stem) => stemLayer(stem, -11)),
      ]),
    });
  }

  if (rhythm.length) {
    const used = rhythm.slice(0, 3);
    result.push({
      name: "Groove",
      sceneType: "groove",
      description: "The rhythmic engine: drums, bass and percussion with melodic clutter removed.",
      objectiveTags: ["groove", "dance", "loop", "movement"],
      platformHints: ["reel", "tiktok", "story"],
      recommendedStartMs: grooveWindow.startMs,
      recommendedEndMs: grooveWindow.endMs,
      score: clamp01(avgScore(used) * 0.45 + Math.max(...used.map((stem) => stemMetric(stem, "groove_score", 0.55))) * 0.35 + grooveWindow.score * 0.2),
      rationale: { stem_ids: used.map((stem) => stem.id) as unknown as Json, selected_window_provenance: grooveWindow.provenance ?? null, reason: "Selects the window where the rhythmic stems themselves are strongest, then isolates them for movement-led media." },
      recipe: sceneRecipe(used.map((stem) => stemLayer(stem, stem.category === "bass" ? -1 : 0))),
    });
  }

  if (atmosphere.length) {
    const used = atmosphere.slice(0, 4);
    const atmosphereWindow = candidateWindow(musicMap, "story_arc", 30000, used);
    result.push({
      name: "Atmosphere",
      sceneType: "atmosphere",
      description: "Pads, keys, synth texture and FX without the main rhythmic or vocal foreground.",
      objectiveTags: ["mood", "cinematic", "text", "teaser"],
      platformHints: ["story", "carousel", "reel"],
      recommendedStartMs: atmosphereWindow.startMs,
      recommendedEndMs: atmosphereWindow.endMs,
      score: clamp01(avgScore(used) * 0.8 + atmosphereWindow.score * 0.2),
      rationale: { stem_ids: used.map((stem) => stem.id) as unknown as Json, selected_window_provenance: atmosphereWindow.provenance ?? null, reason: "Chooses a texture-rich low-clutter window suitable for visual storytelling." },
      recipe: sceneRecipe(used.map((stem, index) => stemLayer(stem, index === 0 ? -2 : -5))),
    });
  }

  if (melodic.length) {
    const spotlight = melodic[0];
    const subtleRhythm = rhythm.slice(0, 2);
    const spotlightWindow = candidateWindow(musicMap, "musical_identity", 15000, [spotlight]);
    result.push({
      name: `${STEM_CATEGORY_LABELS[spotlight.category]} Spotlight`,
      sceneType: "instrument_spotlight",
      description: "A recognizable musical layer presented as the hero, with a restrained pulse underneath when useful.",
      objectiveTags: ["production", "musicianship", "identity", "breakdown"],
      platformHints: ["reel", "tiktok", "story"],
      recommendedStartMs: spotlightWindow.startMs,
      recommendedEndMs: spotlightWindow.endMs,
      score: clamp01(stemCapabilityScore(spotlight) * 0.78 + spotlightWindow.score * 0.22),
      rationale: { primary_stem_id: spotlight.id, category: spotlight.category, selected_window_provenance: spotlightWindow.provenance ?? null, reason: "Selects the strongest identity window of the highest-scoring non-vocal melodic stem." },
      recipe: sceneRecipe([
        stemLayer(spotlight, 0),
        ...subtleRhythm.map((stem) => stemLayer(stem, -12)),
      ]),
    });
  }

  if (nonVocals.length) {
    const bed = nonVocals.filter((stem) => stem.category !== "fx").slice(0, 6);
    const fx = ranked(nonVocals, ["fx"]).slice(0, 1);
    const used = [...bed, ...fx];
    const voiceoverWindow = candidateWindow(musicMap, "story_arc", 30000, used);
    result.push({
      name: "Voiceover Bed",
      sceneType: "voiceover_bed",
      description: "An intelligible background mix that keeps groove and identity while leaving speech in control.",
      objectiveTags: ["voiceover", "education", "behind-the-scenes", "announcement"],
      platformHints: ["story", "reel", "tiktok"],
      recommendedStartMs: voiceoverWindow.startMs,
      recommendedEndMs: voiceoverWindow.endMs,
      score: clamp01(avgScore(used) * 0.7 + voiceoverWindow.score * 0.15 + 0.15),
      rationale: { stem_ids: used.map((stem) => stem.id) as unknown as Json, selected_window_provenance: voiceoverWindow.provenance ?? null, reason: "Vocals removed, a musically coherent low-clutter window selected, and remaining stems attenuated to protect narration intelligibility." },
      recipe: sceneRecipe(used.map((stem) => stemLayer(stem, stem.category === "drums" || stem.category === "bass" ? -11 : -14)), {
        intended_dialogue_headroom_db: 10,
      }),
    });
  }

  if (ready.length >= 3) {
    const revealCore = [
      ...ranked(ready, ["drums", "percussion"]).slice(0, 1),
      ...ranked(ready, ["bass"]).slice(0, 1),
      ...ranked(ready, ["guitar", "keys", "synth", "strings", "brass", "woodwinds", "other"]).slice(0, 2),
    ].filter((stem, index, values) => values.findIndex((item) => item.id === stem.id) === index).slice(0, 4);
    const revealGroups = [
      ...revealCore.map((stem) => [stem]),
      ...(vocals.length ? [vocals] : []),
    ];
    const used = [...revealCore, ...vocals];
    const revealWindow = candidateWindow(musicMap, "build_drop", 15000, used);
    const windowDuration = revealWindow.endMs - revealWindow.startMs;
    const rawStep = Math.max(1200, Math.min(2500, Math.floor(windowDuration / Math.max(3, revealGroups.length))));
    const bpm = number(record(musicMap).bpm, 0);
    const barMs = bpm > 0 ? (60000 / bpm) * 4 : rawStep;
    const stepMs = Math.max(900, Math.round(rawStep / Math.max(1, barMs / 2)) * Math.max(1, Math.round(barMs / 2)));
    result.push({
      name: "Build the Track",
      sceneType: "progressive_reveal",
      description: "Layers enter one by one, with the complete vocal stack arriving together as a musical unit before the payoff.",
      objectiveTags: ["breakdown", "retention", "production", "reveal"],
      platformHints: ["reel", "tiktok"],
      recommendedStartMs: revealWindow.startMs,
      recommendedEndMs: Math.max(revealWindow.endMs, revealWindow.startMs + stepMs * revealGroups.length),
      score: clamp01(avgScore(used) * 0.72 + revealWindow.score * 0.2 + 0.08),
      rationale: {
        entry_groups: revealGroups.map((group) => group.map((stem) => stem.id)) as unknown as Json,
        step_ms: stepMs,
        selected_window_provenance: revealWindow.provenance ?? null,
        reason: "Progressively reveals legible instrumental layers in a build-oriented window; entry cadence is quantized to the canonical master tempo.",
      },
      recipe: sceneRecipe(revealGroups.flatMap((group, index) => group.map((stem) => ({
        ...stemLayer(stem, 0),
        start_at_ms: index * stepMs,
        fade_in_ms: 90,
      }))), {
        automation: { kind: "progressive_reveal", step_ms: stepMs },
      }),
    });
  }

  if (vocals.length && ready.length >= 3) {
    const dropWindow = candidateWindow(musicMap, "build_drop", 15000, vocals);
    const transitionMs = snappedTransitionMs(musicMap, dropWindow, 0.3);
    result.push({
      name: "Vocal → Drop",
      sceneType: "vocal_to_drop",
      description: "Start exposed on the complete vocal stack, then hand the moment to the canonical full master for maximum payoff.",
      objectiveTags: ["hook", "transition", "drop", "retention"],
      platformHints: ["reel", "tiktok", "story"],
      recommendedStartMs: dropWindow.startMs,
      recommendedEndMs: dropWindow.endMs,
      score: clamp01(avgScore(vocals) * 0.4 + dropWindow.score * 0.6),
      rationale: {
        vocal_stem_ids: vocals.map((stem) => stem.id) as unknown as Json,
        transition_ms: transitionMs,
        transition_absolute_ms: dropWindow.startMs + transitionMs,
        transition_grid: gridPoints(musicMap, "downbeats_ms").length ? "downbeat" : "beat",
        selected_window_provenance: dropWindow.provenance ?? null,
        reason: "Exposes the complete vocal arrangement before a musically snapped handoff to the canonical master, preserving harmonies and backing parts.",
      },
      recipe: sceneRecipe([
        ...vocals.map((stem) => ({ ...stemLayer(stem, 0), end_at_ms: transitionMs + 120, fade_out_ms: 120 })),
        { source: "master", gain_db: 0, start_at_ms: transitionMs, fade_in_ms: 80 },
      ]),
    });
  }

  result.push({
    name: "Full Impact",
    sceneType: "full_impact",
    description: "The canonical mastered track at the strongest payoff window. No stem recombination compromises the final master.",
    objectiveTags: ["release", "drop", "climax", "primary-hook"],
    platformHints: ["reel", "tiktok", "story", "video"],
    recommendedStartMs: climax.startMs,
    recommendedEndMs: climax.endMs,
    score: clamp01(climax.score),
    rationale: { selected_window_provenance: climax.provenance ?? null, reason: "Uses the canonical master directly at the strongest master-plus-stem payoff window for maximum fidelity and impact." },
    recipe: sceneRecipe([{ source: "master", gain_db: 0 }]),
  });

  return result
    .filter((scene) => scene.recommendedEndMs > scene.recommendedStartMs)
    .sort((a, b) => b.score - a.score);
}

export function sceneTypeLabel(type: AudioSceneType) {
  return ({
    vocal_spotlight: "Vocal Spotlight",
    groove: "Groove",
    atmosphere: "Atmosphere",
    instrument_spotlight: "Instrument Spotlight",
    voiceover_bed: "Voiceover Bed",
    progressive_reveal: "Build the Track",
    vocal_to_drop: "Vocal → Drop",
    full_impact: "Full Impact",
    custom: "Custom",
  } satisfies Record<AudioSceneType, string>)[type];
}
