"use client";

import { useMemo, useState } from "react";
import {
  parseRekordboxXml,
  type RekordboxXmlContext,
} from "@/lib/dj-library/rekordbox-xml";
import { observeDjLibraryHistory } from "@/lib/dj-library/history-signal";
import styles from "./rekordbox-import-panel.module.css";

type ImportSummary = {
  fileName: string;
  sourceId: string;
  revision: string;
  trackCount: number;
  playlistCount: number;
  cueCount: number;
  griddedTrackCount: number;
  historyCount: number;
  observation: ReturnType<typeof observeDjLibraryHistory>;
};

type LearnResponse = {
  saved?: boolean;
  learnedConfidence?: number;
  evidenceCount?: number;
  error?: string;
};

const MAX_FILE_BYTES = 64 * 1024 * 1024;

export function RekordboxImportPanel({ artistId }: { artistId: string }) {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<LearnResponse | null>(null);

  const learnable = useMemo(
    () => Boolean(summary && summary.observation.orderedPairCount > 0),
    [summary],
  );

  async function readFile(file: File | null) {
    setSummary(null);
    setLearned(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That Rekordbox XML is larger than the 64 MiB local import safety limit.");
      return;
    }
    try {
      const xml = await file.text();
      const context: RekordboxXmlContext = {
        xml,
        sourceId: "rekordbox-xml",
        displayName: file.name,
      };
      const parsed = parseRekordboxXml(context);
      const observation = observeDjLibraryHistory(parsed.tracks, parsed.history);
      setSummary({
        fileName: file.name,
        sourceId: parsed.source.sourceId,
        revision: parsed.revision,
        trackCount: parsed.tracks.length,
        playlistCount: parsed.playlists.filter((playlist) => playlist.kind !== "folder").length,
        cueCount: parsed.tracks.reduce((sum, track) => sum + track.cuePoints.length, 0),
        griddedTrackCount: parsed.tracks.filter((track) => track.beatGrid).length,
        historyCount: parsed.history.length,
        observation,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read this Rekordbox XML export.");
    }
  }

  async function learnFromHistory() {
    if (!summary || !learnable || learning) return;
    setLearning(true);
    setError(null);
    try {
      const response = await fetch("/api/studio/dj-library/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artistId,
          sourceKind: "rekordbox",
          sourceId: summary.sourceId,
          sourceRevision: summary.revision,
          observation: summary.observation,
        }),
      });
      const payload = await response.json().catch(() => ({})) as LearnResponse;
      if (!response.ok) throw new Error(payload.error || "Could not learn from Rekordbox history.");
      setLearned(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not learn from Rekordbox history.");
    } finally {
      setLearning(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="rekordbox-import-title">
      <div className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>External DJ library · Phase 7</p>
          <h2 id="rekordbox-import-title">Rekordbox XML</h2>
          <p className={styles.description}>
            Inspect an official Rekordbox XML export locally. File locations stay in this browser session;
            only a bounded, aggregate play-history observation can be saved to Personal DJ Intelligence.
          </p>
        </div>
        <label className={styles.fileButton}>
          <span>{summary ? "Choose another XML" : "Choose Rekordbox XML"}</span>
          <input
            className={styles.fileInput}
            type="file"
            accept=".xml,text/xml,application/xml"
            onChange={(event) => void readFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {summary ? (
        <div className={styles.result}>
          <div className={styles.fileMeta}>
            <strong>{summary.fileName}</strong>
            <span>Revision {summary.revision}</span>
          </div>
          <div className={styles.metrics}>
            <Metric label="Tracks" value={summary.trackCount} />
            <Metric label="Playlists" value={summary.playlistCount} />
            <Metric label="Cue points" value={summary.cueCount} />
            <Metric label="Beat grids" value={summary.griddedTrackCount} />
            <Metric label="History plays" value={summary.historyCount} />
          </div>
          <div className={styles.learningRow}>
            <div>
              <strong>{learnable ? "History intelligence is available" : "No ordered history was found"}</strong>
              <p>
                {learnable
                  ? `${summary.observation.orderedPairCount} played transitions can provide weak evidence about tempo and harmonic movement.`
                  : "Tracks, playlists, cues and grids were still parsed successfully. Nothing will be learned from history."}
              </p>
            </div>
            {learnable ? (
              <button className="button" type="button" onClick={() => void learnFromHistory()} disabled={learning}>
                {learning ? "Learning…" : learned?.saved ? "History learned" : "Learn from history"}
              </button>
            ) : null}
          </div>
          {learned?.saved ? (
            <p className={styles.success}>
              Personal DJ Intelligence updated with bounded observational evidence. Learned confidence is {Math.round((learned.learnedConfidence ?? 0) * 100)}% across {learned.evidenceCount ?? 0} evidence events.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <span>XML is parsed on-device</span>
          <span>Rekordbox paths are never posted by this importer</span>
          <span>No direct Rekordbox database mutation</span>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
