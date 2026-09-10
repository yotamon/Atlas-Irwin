import assert from "node:assert/strict";
import test from "node:test";
import { curateReleaseMoments } from "../lib/studio/moments-curator.ts";

const TRACK_ID = "00000000-0000-4000-8000-000000000001";
const RELEASE_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_ID = "00000000-0000-4000-8000-000000000003";
const ARTIST_ID = "00000000-0000-4000-8000-000000000004";

function moment(overrides = {}) {
  const index = overrides.index ?? 1;
  const start = overrides.start_ms ?? 64_480;
  const end = overrides.end_ms ?? 69_692;
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    owner_id: OWNER_ID,
    artist_id: ARTIST_ID,
    release_id: RELEASE_ID,
    track_id: TRACK_ID,
    start_ms: start,
    end_ms: end,
    source_start_ms: overrides.source_start_ms ?? start,
    source_end_ms: overrides.source_end_ms ?? end,
    moment_type: overrides.moment_type ?? "primary_hook",
    label: overrides.label ?? "The invitation that defines the night",
    source_mode: overrides.source_mode ?? "lyrics",
    source_fingerprint: overrides.source_fingerprint ?? `fingerprint-${index}`,
    purpose_tags: overrides.purpose_tags ?? ["primary_hook"],
    energy_score: overrides.energy_score ?? 0.82,
    hook_score: overrides.hook_score ?? 0.9,
    emotional_score: overrides.emotional_score ?? 0.7,
    vocal_score: overrides.vocal_score ?? 0.88,
    uniqueness_score: overrides.uniqueness_score ?? 0.72,
    confidence: overrides.confidence ?? 0.9,
    track_analysis_version: overrides.track_analysis_version ?? 3,
    track_analysis_audio_sha256: overrides.track_analysis_audio_sha256 ?? "audio-sha",
    source_candidate_id: overrides.source_candidate_id ?? `candidate-${index}`,
    lyric_moment_id: overrides.lyric_moment_id ?? null,
    lyrics_version: overrides.lyrics_version ?? 1,
    audio_scene_id: overrides.audio_scene_id ?? null,
    audio_scene_recipe_version: overrides.audio_scene_recipe_version ?? null,
    evidence: overrides.evidence ?? {},
    state: overrides.state ?? "proposed",
    reviewed_by: overrides.reviewed_by ?? null,
    reviewed_at: overrides.reviewed_at ?? null,
    superseded_by_id: overrides.superseded_by_id ?? null,
    created_at: overrides.created_at ?? "2026-09-04T18:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-09-04T18:00:00.000Z",
  };
}

const chorus = {
  id: "10000000-0000-4000-8000-000000000001",
  track_id: TRACK_ID,
  section_key: "chorus_1",
  section_type: "chorus",
  label: "Dancefloor invitation",
  start_ms: 64_480,
  end_ms: 87_510,
  confidence: 1,
  is_primary_hook: true,
};

test("Meet Me at the Dancefloor: dozens of overlapping signals become one full chorus", () => {
  const raw = [
    moment({ index: 1, source_mode: "lyrics", start_ms: 64_480, end_ms: 69_692, lyric_moment_id: "20000000-0000-4000-8000-000000000001", evidence: { section_key: "chorus_1" } }),
    moment({ index: 2, source_mode: "audio", start_ms: 64_480, end_ms: 79_830, evidence: { section_label: "Chorus" }, confidence: 0.84 }),
    moment({ index: 3, source_mode: "stems", start_ms: 64_480, end_ms: 79_830, audio_scene_id: "30000000-0000-4000-8000-000000000001", confidence: 0.81 }),
    moment({ index: 4, source_mode: "fused", start_ms: 66_400, end_ms: 69_692, evidence: { source_modes: ["lyrics", "audio"] }, confidence: 0.98 }),
    moment({ index: 5, source_mode: "fused", start_ms: 64_480, end_ms: 69_692, evidence: { source_modes: ["lyrics", "stems"] }, confidence: 0.97 }),
    moment({ index: 6, source_mode: "fused", start_ms: 64_480, end_ms: 79_830, evidence: { source_modes: ["audio", "stems"] }, confidence: 0.96 }),
  ];

  const result = curateReleaseMoments({
    moments: raw,
    sections: [chorus],
    lyricMoments: [{
      id: "20000000-0000-4000-8000-000000000001",
      track_id: TRACK_ID,
      section_key: "chorus_1",
      excerpt: "Meet me at the dancefloor",
      start_ms: 64_480,
      end_ms: 69_692,
      score: 0.99,
    }],
  });

  assert.equal(result.curated.length, 1);
  assert.equal(result.curated[0].start_ms, 64_480);
  assert.equal(result.curated[0].end_ms, 87_510);
  assert.equal(result.curated[0].label, "Dancefloor invitation");
  assert.equal(result.curated[0].curation.section_key, "chorus_1");
  assert.equal(result.curated[0].curation.primary_hook, true);
  assert.equal(result.curated[0].curation.promoted_to_full_section, true);
  assert.equal(result.curated[0].curation.candidate_count, 6);
  assert.deepEqual(result.curated[0].curation.source_modes, ["audio", "lyrics", "stems"]);
  assert.equal(result.raw_active_count, 6);
  assert.equal(result.suppressed_count, 5);
});

test("canonical Moments are not cropped to a fixed 15-second social window", () => {
  const result = curateReleaseMoments({
    moments: [moment({ index: 10, source_mode: "audio", start_ms: 64_480, end_ms: 79_830 })],
    sections: [chorus],
  });

  assert.equal(result.curated[0].start_ms, 64_480);
  assert.equal(result.curated[0].end_ms, 87_510);
  assert.equal(result.curated[0].end_ms - result.curated[0].start_ms, 23_030);
});

test("lyric text is only attached when its timed highlight belongs inside the curated Moment", () => {
  const lyricId = "20000000-0000-4000-8000-000000000099";
  const result = curateReleaseMoments({
    moments: [moment({ index: 20, lyric_moment_id: lyricId, evidence: { section_key: "chorus_1" } })],
    sections: [chorus],
    lyricMoments: [{
      id: lyricId,
      track_id: TRACK_ID,
      section_key: "verse_2",
      excerpt: "This lyric is somewhere else",
      start_ms: 117_260,
      end_ms: 121_379,
      score: 0.93,
    }],
  });

  assert.equal(result.curated[0].lyric_moment_id, null);
});

test("artist-edited timing is preserved instead of being auto-expanded", () => {
  const result = curateReleaseMoments({
    moments: [moment({
      index: 30,
      start_ms: 66_400,
      end_ms: 82_000,
      source_start_ms: 64_480,
      source_end_ms: 69_692,
      evidence: { section_key: "chorus_1" },
    })],
    sections: [chorus],
  });

  assert.equal(result.curated[0].start_ms, 66_400);
  assert.equal(result.curated[0].end_ms, 82_000);
  assert.equal(result.curated[0].curation.manual_timing, true);
  assert.equal(result.curated[0].curation.promoted_to_full_section, false);
});

test("artist workflow has a five-Moment ceiling and does not pad weak results", () => {
  const strong = Array.from({ length: 7 }, (_, index) => {
    const start = index * 30_000;
    return moment({
      index: 100 + index,
      source_mode: "audio",
      start_ms: start,
      end_ms: start + 16_000,
      confidence: 0.92 - index * 0.01,
      hook_score: 0.86 - index * 0.01,
      evidence: {},
    });
  });
  const capped = curateReleaseMoments({ moments: strong, sections: [] });
  assert.equal(capped.curated.length, 5);

  const weak = curateReleaseMoments({
    moments: [moment({
      index: 200,
      source_mode: "audio",
      start_ms: 10_000,
      end_ms: 13_500,
      confidence: 0.2,
      hook_score: 0.1,
      energy_score: 0.1,
      emotional_score: 0.1,
      vocal_score: 0.1,
      uniqueness_score: 0.1,
    })],
    sections: [],
  });
  assert.equal(weak.curated.length, 0);
});

test("artist-facing ceiling also applies when many legacy Moments are already approved", () => {
  const approved = Array.from({ length: 8 }, (_, index) => {
    const start = index * 32_000;
    return moment({
      index: 300 + index,
      state: "approved",
      source_mode: "audio",
      start_ms: start,
      end_ms: start + 18_000,
      confidence: 0.98 - index * 0.02,
      hook_score: 0.94 - index * 0.02,
    });
  });

  const result = curateReleaseMoments({ moments: approved, sections: [] });
  assert.equal(result.curated.length, 5);
  assert.equal(result.raw_active_count, 8);
  assert.equal(result.suppressed_count, 3);
  assert.deepEqual(result.curated.map((item) => item.curation.rank), [1, 2, 3, 4, 5]);
});
