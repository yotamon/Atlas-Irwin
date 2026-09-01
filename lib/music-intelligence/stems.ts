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
  const metrics = record(analysis.metrics);
  const direct = analysis[key];
  if (typeof direct === "number") return clamp01(direct);
  if (typeof summary[key] === "number") return clamp01(summary[key] as number);
  if (typeof metrics[key] === "number") return clamp01(metrics[key] as number);
  return fallback;
}

export function stemCapabilityScore(stem: TrackStem) {
  const energy = stemMetric(stem, "energy", 0.5);
  const hook = stemMetric(stem, "hook_score", stemMetric(stem, "salience", 0.5));
  const groove = stemMetric(stem, "groove_score", 0.35);
  const loopability = stemMetric(stem, "loopability", 0.5);
  const activeRatio = stemMetric(stem, "active_ratio", 0.5);
  return clamp01(energy * 0.2 + hook * 0.35 + groove * 0.15 + loopability * 0.15 + activeRatio * 0.15);
}

function ranked(stems: TrackStem[], categories?: StemCategory[]) {
  return stems
    .filter((stem) => stem.status === "ready" && (!categories || categories.includes(stem.category)))
    .sort((a, b) => stemCapabilityScore(b) - stemCapabilityScore(a));
}

function readWindow(value: unknown): { startMs: number; endMs: number; score: number } | null {
  const row = record(value);
  const startMs = number(row.start_ms, Number.NaN);
  const endMs = number(row.end_ms, Number.NaN);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, score: clamp01(number(row.score, 0.7)) };
}

function candidateWindow(musicMap: Json | null | undefined, intent: string, preferredMs = 15000) {
  const map = record(musicMap);
  const socialCuts = record(map.social_cuts);
  for (const key of ["15s", "15", "hook_15"]) {
    const window = readWindow(socialCuts[key]);
    if (window) return window;
  }

  const moments = record(map.moments);
  const intentMoments = moments[intent];
  if (Array.isArray(intentMoments)) {
    for (const moment of intentMoments) {
      const window = readWindow(moment);
      if (window) return window;
      const candidateId = record(moment).candidate_id;
      if (typeof candidateId === "string" && Array.isArray(map.hook_candidates)) {
        const match = map.hook_candidates.find((item) => record(item).id === candidateId);
        const matchedWindow = readWindow(match);
        if (matchedWindow) return matchedWindow;
      }
    }
  }

  if (Array.isArray(map.hook_candidates)) {
    const candidates = map.hook_candidates
      .map(readWindow)
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => b.score - a.score);
    if (candidates[0]) return candidates[0];
  }

  const durationMs = number(map.duration_ms, 0);
  const endMs = durationMs ? Math.min(durationMs, preferredMs) : preferredMs;
  return { startMs: 0, endMs, score: 0.45 };
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

export function buildSmartAudioScenes(stems: TrackStem[], musicMap?: Json | null): AudioSceneDraft[] {
  const ready = ranked(stems);
  if (!ready.length) return [];

  const vocals = ranked(ready, ["vocals"]);
  const rhythm = ranked(ready, ["drums", "bass", "percussion"]);
  const atmosphere = ranked(ready, ["synth", "keys", "strings", "fx"]);
  const melodic = ranked(ready, ["guitar", "keys", "synth", "strings", "brass", "woodwinds", "other"]);
  const nonVocals = ready.filter((stem) => stem.category !== "vocals");
  const instantHook = candidateWindow(musicMap, "instant_hook");
  const grooveWindow = candidateWindow(musicMap, "groove_loop");
  const climax = candidateWindow(musicMap, "climax");
  const story = candidateWindow(musicMap, "story_arc", 30000);
  const result: AudioSceneDraft[] = [];

  if (vocals.length) {
    const supporting = atmosphere.slice(0, 2);
    const used = [vocals[0], ...supporting];
    result.push({
      name: "Vocal Spotlight",
      sceneType: "vocal_spotlight",
      description: "Lead vocal in front with only enough atmosphere to preserve the release world.",
      objectiveTags: ["lyrics", "identity", "intimacy", "story"],
      platformHints: ["story", "reel", "tiktok"],
      recommendedStartMs: instantHook.startMs,
      recommendedEndMs: instantHook.endMs,
      score: clamp01(avgScore(used) * 0.8 + stemMetric(vocals[0], "hook_score", 0.7) * 0.2),
      rationale: { primary_stem_id: vocals[0].id, reason: "Strong vocal identity with restrained harmonic context." },
      recipe: sceneRecipe([
        stemLayer(vocals[0], 0),
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
      score: clamp01(avgScore(used) * 0.55 + Math.max(...used.map((stem) => stemMetric(stem, "groove_score", 0.55))) * 0.45),
      rationale: { stem_ids: used.map((stem) => stem.id) as unknown as Json, reason: "Highest-value rhythmic stems isolated for movement-led media." },
      recipe: sceneRecipe(used.map((stem) => stemLayer(stem, stem.category === "bass" ? -1 : 0))),
    });
  }

  if (atmosphere.length) {
    const used = atmosphere.slice(0, 4);
    result.push({
      name: "Atmosphere",
      sceneType: "atmosphere",
      description: "Pads, keys, synth texture and FX without the main rhythmic or vocal foreground.",
      objectiveTags: ["mood", "cinematic", "text", "teaser"],
      platformHints: ["story", "carousel", "reel"],
      recommendedStartMs: story.startMs,
      recommendedEndMs: story.endMs,
      score: avgScore(used),
      rationale: { stem_ids: used.map((stem) => stem.id) as unknown as Json, reason: "Low-clutter musical bed suitable for visual storytelling." },
      recipe: sceneRecipe(used.map((stem, index) => stemLayer(stem, index === 0 ? -2 : -5))),
    });
  }

  if (melodic.length) {
    const spotlight = melodic[0];
    const subtleRhythm = rhythm.slice(0, 2);
    result.push({
      name: `${STEM_CATEGORY_LABELS[spotlight.category]} Spotlight`,
      sceneType: "instrument_spotlight",
      description: "A recognizable musical layer presented as the hero, with a restrained pulse underneath when useful.",
      objectiveTags: ["production", "musicianship", "identity", "breakdown"],
      platformHints: ["reel", "tiktok", "story"],
      recommendedStartMs: instantHook.startMs,
      recommendedEndMs: instantHook.endMs,
      score: stemCapabilityScore(spotlight),
      rationale: { primary_stem_id: spotlight.id, category: spotlight.category, reason: "Highest-scoring non-vocal melodic stem." },
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
    result.push({
      name: "Voiceover Bed",
      sceneType: "voiceover_bed",
      description: "An intelligible background mix that keeps groove and identity while leaving speech in control.",
      objectiveTags: ["voiceover", "education", "behind-the-scenes", "announcement"],
      platformHints: ["story", "reel", "tiktok"],
      recommendedStartMs: story.startMs,
      recommendedEndMs: story.endMs,
      score: clamp01(avgScore(used) * 0.8 + 0.15),
      rationale: { stem_ids: used.map((stem) => stem.id) as unknown as Json, reason: "Vocals removed and remaining stems attenuated to protect narration intelligibility." },
      recipe: sceneRecipe(used.map((stem) => stemLayer(stem, stem.category === "drums" || stem.category === "bass" ? -11 : -14)), {
        intended_dialogue_headroom_db: 10,
      }),
    });
  }

  if (ready.length >= 3) {
    const revealOrder = [
      ...ranked(ready, ["drums", "percussion"]).slice(0, 1),
      ...ranked(ready, ["bass"]).slice(0, 1),
      ...ranked(ready, ["guitar", "keys", "synth", "strings", "brass", "woodwinds", "other"]).slice(0, 2),
      ...vocals.slice(0, 1),
    ].filter((stem, index, values) => values.findIndex((item) => item.id === stem.id) === index).slice(0, 5);
    const stepMs = Math.max(1200, Math.min(2500, Math.floor((instantHook.endMs - instantHook.startMs) / Math.max(3, revealOrder.length))));
    result.push({
      name: "Build the Track",
      sceneType: "progressive_reveal",
      description: "Layers enter one by one so the audience hears the arrangement assemble before the payoff.",
      objectiveTags: ["breakdown", "retention", "production", "reveal"],
      platformHints: ["reel", "tiktok"],
      recommendedStartMs: instantHook.startMs,
      recommendedEndMs: Math.max(instantHook.endMs, instantHook.startMs + stepMs * revealOrder.length),
      score: clamp01(avgScore(revealOrder) * 0.9 + 0.08),
      rationale: { entry_order: revealOrder.map((stem) => stem.id) as unknown as Json, step_ms: stepMs, reason: "Progressively reveals the most legible rhythmic and melodic layers." },
      recipe: sceneRecipe(revealOrder.map((stem, index) => ({
        ...stemLayer(stem, 0),
        start_at_ms: index * stepMs,
        fade_in_ms: 90,
      })), {
        automation: { kind: "progressive_reveal", step_ms: stepMs },
      }),
    });
  }

  if (vocals.length && ready.length >= 3) {
    const transitionMs = Math.max(1800, Math.min(4500, Math.floor((climax.endMs - climax.startMs) * 0.28)));
    result.push({
      name: "Vocal → Drop",
      sceneType: "vocal_to_drop",
      description: "Start exposed on the vocal, then hand the moment to the canonical full master for maximum payoff.",
      objectiveTags: ["hook", "transition", "drop", "retention"],
      platformHints: ["reel", "tiktok", "story"],
      recommendedStartMs: climax.startMs,
      recommendedEndMs: climax.endMs,
      score: clamp01(stemCapabilityScore(vocals[0]) * 0.45 + climax.score * 0.55),
      rationale: { vocal_stem_id: vocals[0].id, transition_ms: transitionMs, reason: "Contrast creates a stronger arrival than starting immediately on the full mix." },
      recipe: sceneRecipe([
        { ...stemLayer(vocals[0], 0), end_at_ms: transitionMs + 120, fade_out_ms: 120 },
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
    rationale: { reason: "Uses the canonical master directly for maximum fidelity and impact." },
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
