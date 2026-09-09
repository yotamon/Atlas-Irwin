import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function loadTypeScriptModule(path, runtimePrelude = "") {
  const input = await source(path);
  const compiled = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: path,
  }).outputText;
  const withoutRuntimeSourceContract = compiled.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*["']\.\.\/automix\/source-contract["'];?\s*/,
    runtimePrelude,
  );
  const encoded = Buffer.from(withoutRuntimeSourceContract).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

const sourceContractPrelude = `
const DJ_LIBRARY_CONTRACT_VERSION = "ensemblis.dj-library-source.v1";
const SOURCE_CONTRACT_VERSION = "ensemblis.automix-source.v1";
const sourceStableTrackId = (kind, sourceId, sourceTrackId) => \`${"${kind}:${sourceId}:${sourceTrackId}"}\`;
`;

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7" Company="AlphaTheta"/>
  <COLLECTION Entries="2">
    <TRACK TrackID="1" Name="First &amp; Bright" Artist="Atlas Irwin" Album="Set" Genre="Nu Disco" TotalTime="240" AverageBpm="120.00" Rating="204" Location="file://localhost/C:/Music/first.wav" Tonality="8A" LastPlayed="2026-09-01">
      <TEMPO Inizio="0.000" Bpm="120.00" Metro="4/4" Battito="1"/>
      <TEMPO Inizio="90.000" Bpm="122.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Drop" Type="0" Start="32.000" Num="0" Red="255" Green="120" Blue="20"/>
      <POSITION_MARK Name="Loop" Type="4" Start="64.000" End="72.000" Num="-1"/>
    </TRACK>
    <TRACK TrackID="2" Name="Second" Artist="Atlas Irwin" TotalTime="210" AverageBpm="126.00" Rating="255" Location="file://localhost/C:/Music/second.wav" Tonality="9A" LastPlayed="2026-09-01">
      <TEMPO Inizio="0.000" Bpm="126.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Memory" Type="0" Start="16.000" Num="-1"/>
    </TRACK>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Type="1" Name="HISTORY 2026-09-01" Entries="2" KeyType="0">
        <TRACK Key="1"/>
        <TRACK Key="2"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`;

test("Rekordbox XML parser normalizes official collection, grid, cues, playlists and history", async () => {
  const loadedModule = await loadTypeScriptModule("lib/dj-library/rekordbox-xml.ts", sourceContractPrelude);
  const parsed = loadedModule.parseRekordboxXml({ xml: fixture, sourceId: "fixture" });

  assert.equal(parsed.tracks.length, 2);
  assert.equal(parsed.tracks[0].metadata.title, "First & Bright");
  assert.equal(parsed.tracks[0].metadata.rating, 4);
  assert.equal(parsed.tracks[0].beatGrid.variableTempo, true);
  assert.deepEqual(parsed.tracks[0].cuePoints.map((cue) => cue.kind), ["hot_cue", "loop"]);
  assert.equal(parsed.tracks[1].cuePoints[0].kind, "memory");
  assert.equal(parsed.history.length, 2);
  assert.equal(parsed.playlists.some((playlist) => playlist.kind === "history"), true);
  assert.equal(parsed.tracks[0].source.executionTarget, "device");
  assert.equal(parsed.tracks[0].source.revision, parsed.revision);
  assert.equal(JSON.stringify(parsed.tracks).includes("C:/Music"), false, "normalized/cloud-safe tracks must not expose local paths");
});

test("Rekordbox XML parser rejects DTD/entity declarations and unsafe input", async () => {
  const loadedModule = await loadTypeScriptModule("lib/dj-library/rekordbox-xml.ts", sourceContractPrelude);
  assert.throws(
    () => loadedModule.parseRekordboxXml({ xml: `<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]>${fixture}` }),
    /DTD\/entity declarations/,
  );
  assert.throws(() => loadedModule.parseRekordboxXml({ xml: "<xml/>" }), /not a supported Rekordbox/);
});

test("safe Rekordbox export requires explicit local file URIs and round-trips normalized evidence", async () => {
  const loadedModule = await loadTypeScriptModule("lib/dj-library/rekordbox-xml.ts", sourceContractPrelude);
  const parsed = loadedModule.parseRekordboxXml({ xml: fixture, sourceId: "fixture" });

  assert.throws(
    () => loadedModule.exportRekordboxXml({ tracks: parsed.tracks, playlists: parsed.playlists, locationForTrack: () => null }),
    /explicit local file:\/\//,
  );

  const exported = loadedModule.exportRekordboxXml({
    tracks: parsed.tracks,
    playlists: parsed.playlists,
    locationForTrack: (track) => `file://localhost/D:/Export/${track.sourceTrackId}.wav`,
  });
  assert.ok(exported.includes('<DJ_PLAYLISTS Version="1.0.0">'));
  assert.ok(exported.includes('POSITION_MARK Name="Drop" Type="0"'));
  const roundTrip = loadedModule.parseRekordboxXml({ xml: exported, sourceId: "roundtrip" });
  assert.equal(roundTrip.tracks.length, 2);
  assert.equal(roundTrip.tracks[0].metadata.rating, 4);
  assert.equal(roundTrip.tracks[0].cuePoints.some((cue) => cue.kind === "loop"), true);
});

test("play history produces bounded aggregate observations without raw track identity", async () => {
  const rekordbox = await loadTypeScriptModule("lib/dj-library/rekordbox-xml.ts", sourceContractPrelude);
  const historyModule = await loadTypeScriptModule("lib/dj-library/history-signal.ts");
  const parsed = rekordbox.parseRekordboxXml({ xml: fixture, sourceId: "fixture" });
  const observation = historyModule.observeDjLibraryHistory(parsed.tracks, parsed.history);
  const preference = historyModule.preferenceSignalFromHistoryObservation(observation);

  assert.equal(observation.sampleCount, 2);
  assert.equal(observation.orderedPairCount, 1);
  assert.ok(observation.tempoMovement > 0);
  assert.ok(observation.harmonicAdventure >= 0 && observation.harmonicAdventure <= 1);
  assert.ok(preference.weight <= 0.35);
  assert.equal("trackIds" in observation, false);
  assert.equal("paths" in observation, false);
});

test("server ingestion accepts only normalized history observations and persistence stays weak", async () => {
  const route = await source("app/api/studio/dj-library/history/route.ts");
  const personalization = await source("lib/automix/personalization.ts");
  const migration = await source("supabase/migrations/20260910001500_dj_library_history_evidence.sql");

  assert.ok(route.includes("preferenceSignalFromHistoryObservation(body.observation)"));
  assert.equal(route.includes("body.xml"), false);
  assert.equal(route.includes("Location"), false);
  assert.ok(personalization.includes("boundedLibraryHistoryRows"));
  assert.ok(personalization.includes("total > 1.5 ? 1.5 / total : 1"));
  assert.ok(personalization.includes("Math.min(0.4, clampWeight(weight))"));
  assert.ok(migration.includes("weight > 0 and weight <= 0.4"));
  assert.ok(migration.includes("Raw paths and per-track library history are intentionally not persisted"));
});
