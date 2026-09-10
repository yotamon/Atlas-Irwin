import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadTiming() {
  const source = await readFile("lib/lyrics-intelligence/timing.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const lyric = (id, order, type, text) => ({
  id,
  lyrics_id: "lyrics",
  owner_id: "owner",
  lyrics_version: 1,
  section_key: id,
  section_type: type,
  label: type,
  display_order: order,
  text,
  structure_source: "ai",
  confidence: 0.9,
  is_primary_hook: type === "chorus",
  allow_media: true,
  start_ms: null,
  end_ms: null,
  timing_source: null,
  music_section_id: null,
  created_at: "",
  updated_at: "",
});

const music = (id, start, end, type, confidence = 0.7) => ({
  id,
  start_ms: start,
  end_ms: end,
  type,
  label: type,
  energy: 0.5,
  confidence,
});

test("lyrics section alignment is globally monotonic and cannot place Verse 2 before Chorus 1", async () => {
  const { alignLyricSectionsMonotonically } = await loadTiming();
  const lyrics = [
    lyric("intro_1", 0, "intro", "My love\nMy love\nMy love"),
    lyric("verse_1", 1, "verse", "Saw you across the room and I see you walk my way"),
    lyric("chorus_1", 2, "chorus", "Meet me at the dancefloor".repeat(8)),
    lyric("verse_2", 3, "verse", "I cannot get enough and I do not want to say goodbye"),
    lyric("chorus_2", 4, "chorus", "Meet me at the dancefloor".repeat(8)),
    lyric("outro_1", 5, "outro", "Meet me at the dancefloor".repeat(4)),
  ];
  const sections = [
    music("section-1", 0, 630, "intro", 0.48),
    music("section-2", 630, 16430, "intro", 0.57),
    music("section-3", 16430, 33750, "intro", 0.41),
    music("section-4", 33750, 48160, "verse", 0.63),
    music("section-5", 48160, 64480, "verse", 0.50),
    music("section-6", 64480, 87510, "chorus", 0.56),
    music("section-7", 87510, 102860, "verse", 0.66),
    music("section-8", 102860, 117260, "verse", 0.38),
    music("section-9", 117260, 133570, "verse", 0.42),
    music("section-10", 133570, 148930, "chorus", 0.47),
    music("section-11", 148930, 163330, "chorus", 0.58),
    music("section-12", 163330, 179660, "chorus", 0.43),
    music("section-13", 179660, 195050, "chorus", 0.24),
    music("section-14", 195050, 209070, "outro", 0.36),
    music("section-15", 209070, 210000, "outro", 0.32),
  ];
  const vocal = new Map([
    ["section-1", { activeRatio: 0, energy: 0, rhythmicActivity: 0 }],
    ["section-2", { activeRatio: 0.55, energy: 0.45, rhythmicActivity: 0.2 }],
    ["section-4", { activeRatio: 0.6, energy: 0.4, rhythmicActivity: 0.4 }],
    ["section-5", { activeRatio: 0.4, energy: 0.3, rhythmicActivity: 0.3 }],
    ["section-6", { activeRatio: 0.75, energy: 0.55, rhythmicActivity: 0.5 }],
    ["section-7", { activeRatio: 0.85, energy: 0.6, rhythmicActivity: 0.6 }],
    ["section-8", { activeRatio: 0.9, energy: 0.65, rhythmicActivity: 0.6 }],
    ["section-9", { activeRatio: 0.8, energy: 0.5, rhythmicActivity: 0.5 }],
    ["section-10", { activeRatio: 0.7, energy: 0.5, rhythmicActivity: 0.4 }],
    ["section-14", { activeRatio: 0.5, energy: 0.4, rhythmicActivity: 0.3 }],
  ]);

  const aligned = alignLyricSectionsMonotonically(lyrics, sections, vocal);
  const byId = new Map(aligned.map((row) => [row.lyricSectionId, row.musicSection]));
  assert.equal(byId.get("chorus_1")?.id, "section-6");
  assert.ok((byId.get("verse_2")?.start_ms ?? 0) >= (byId.get("chorus_1")?.end_ms ?? 0));
  assert.ok((byId.get("chorus_2")?.start_ms ?? 0) >= (byId.get("verse_2")?.end_ms ?? 0));
  assert.ok((byId.get("outro_1")?.start_ms ?? 0) >= (byId.get("chorus_2")?.end_ms ?? 0));
  assert.notEqual(byId.get("intro_1")?.id, "section-1", "630ms intro is implausible for three sung lyric lines");
});

test("derived lyric line windows are ordered, exhaustive, and bounded by their section", async () => {
  const { interpolateLyricLineTimings } = await loadTiming();
  const timings = interpolateLyricLineTimings(10000, 20000, [
    { id: "a", display_order: 0, text: "Oh" },
    { id: "b", display_order: 1, text: "I cannot get enough of it" },
    { id: "c", display_order: 2, text: "And I do not want to say goodbye" },
  ]);
  assert.equal(timings[0].startMs, 10000);
  assert.equal(timings.at(-1)?.endMs, 20000);
  for (let index = 1; index < timings.length; index += 1) {
    assert.equal(timings[index].startMs, timings[index - 1].endMs);
    assert.ok(timings[index].endMs > timings[index].startMs);
  }
  assert.ok((timings[2].endMs - timings[2].startMs) > (timings[0].endMs - timings[0].startMs));
});
