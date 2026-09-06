"use client";

import { useRef } from "react";
import type { Json } from "@/types/database";
import styles from "./mastering-inspector-panel.module.css";

type CatalogProfile = { title: string; musicMap: Json };
type NumericRecord = Record<string, number>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function signed(value: number, digits = 1) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function metric(value: number | null, suffix: string, digits = 1) {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function time(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusCopy(status: string | null) {
  if (status === "fix_before_release") return { label: "Fix before release", className: styles.statusCritical };
  if (status === "ready_review_suggested") return { label: "Ready, review suggested", className: styles.statusReview };
  return { label: "Ready", className: styles.statusReady };
}

function classificationCopy(value: string | null) {
  if (value === "drifting") return "Tempo drift detected";
  if (value === "unstable") return "Tempo is unstable";
  if (value === "section_tempo_changes") return "Section-aligned tempo changes";
  if (value === "stable") return "Beat grid is stable";
  return "Not enough beat evidence";
}

function issueCategory(value: string | null) {
  if (value === "technical_defect") return "Technical defect";
  if (value === "platform_risk") return "Platform risk";
  if (value === "reference_deviation") return "Reference deviation";
  return "Creative observation";
}

function signatureFromMusicMap(value: Json): Record<string, unknown> {
  const map = asRecord(value);
  return asRecord(asRecord(map.mastering_inspector).reference_signature);
}

function catalogMedian(catalog: CatalogProfile[], key: string): number | null {
  const values = catalog
    .map((profile) => asNumber(signatureFromMusicMap(profile.musicMap)[key]))
    .filter((value): value is number => value !== null);
  return median(values);
}

function catalogBandMedians(catalog: CatalogProfile[]): NumericRecord {
  const keys = ["sub_20_80", "bass_80_180", "low_mid_180_500", "mid_500_2500", "presence_2500_6000", "air_6000_16000"];
  const result: NumericRecord = {};
  for (const key of keys) {
    const values = catalog
      .map((profile) => asNumber(asRecord(signatureFromMusicMap(profile.musicMap).band_relative_db)[key]))
      .filter((value): value is number => value !== null);
    const value = median(values);
    if (value !== null) result[key] = value;
  }
  return result;
}

function beatPolyline(points: Array<{ ms: number; bpm: number }>) {
  if (!points.length) return "";
  const maxMs = Math.max(...points.map((point) => point.ms), 1);
  const values = points.map((point) => point.bpm);
  const minBpm = Math.min(...values);
  const maxBpm = Math.max(...values);
  const span = Math.max(maxBpm - minBpm, 0.5);
  return points.map((point) => {
    const x = (point.ms / maxMs) * 1000;
    const y = 95 - ((point.bpm - minBpm) / span) * 80;
    return `${x},${y}`;
  }).join(" ");
}

export function MasteringInspectorPanel({
  audioUrl,
  musicMap,
  catalogProfiles,
}: {
  audioUrl: string | null;
  musicMap: Json;
  catalogProfiles: CatalogProfile[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const map = asRecord(musicMap);
  const inspector = asRecord(map.mastering_inspector);

  if (!Object.keys(inspector).length) {
    return (
      <div className={styles.empty}>
        <strong>Mastering Inspector is available on the latest audio analysis.</strong>
        <p>Re-analyze this master to add standards-based loudness, true peak, dynamics, stereo, codec and beat-stability checks.</p>
      </div>
    );
  }

  const status = statusCopy(asString(inspector.status));
  const loudness = asRecord(inspector.loudness);
  const peaks = asRecord(inspector.peaks);
  const dynamics = asRecord(inspector.dynamics);
  const stereo = asRecord(inspector.stereo);
  const format = asRecord(inspector.format);
  const beat = asRecord(inspector.beat_stability);
  const signature = asRecord(inspector.reference_signature);
  const platform = asRecord(asRecord(asRecord(inspector.platform_previews).spotify).profiles);
  const normalSpotify = asRecord(platform.normal);
  const issues = asArray(inspector.issues).map(asRecord);
  const codecStress = asArray(inspector.codec_stress).map(asRecord);
  const beatTimeline = asArray(beat.timeline).map(asRecord).flatMap((point) => {
    const ms = asNumber(point.ms);
    const bpm = asNumber(point.bpm);
    return ms !== null && bpm !== null ? [{ ms, bpm }] : [];
  });
  const beatChanges = asArray(beat.section_tempo_steps).map(asRecord);
  const currentBands = asRecord(signature.band_relative_db);
  const catalogBands = catalogBandMedians(catalogProfiles);
  const referenceRows = [
    ["Integrated loudness", "integrated_lufs", " LUFS"],
    ["True peak", "true_peak_dbtp", " dBTP"],
    ["Loudness range", "loudness_range_lu", " LU"],
    ["PLR", "peak_to_loudness_ratio_lu", " LU"],
    ["Crest factor", "crest_factor_db", " dB"],
    ["Stereo correlation", "stereo_correlation", ""],
  ] as const;
  const bands = [
    ["Sub", "sub_20_80", "20–80 Hz"],
    ["Bass", "bass_80_180", "80–180 Hz"],
    ["Low-mid", "low_mid_180_500", "180–500 Hz"],
    ["Mid", "mid_500_2500", "500 Hz–2.5 kHz"],
    ["Presence", "presence_2500_6000", "2.5–6 kHz"],
    ["Air", "air_6000_16000", "6–16 kHz"],
  ] as const;

  function listenAt(ms: number) {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.currentTime = Math.max(0, ms / 1000);
    void audio.play().catch(() => undefined);
  }

  return (
    <div className={styles.inspector}>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="metadata" />

      <section className={styles.summary}>
        <div>
          <span className="section-label">Release check</span>
          <h3 className={status.className}>{status.label}</h3>
          <p>Measurements are deterministic. Creative and reference differences are review cues, not automatic mastering failures.</p>
        </div>
        <dl className={styles.summaryFacts}>
          <div><dt>Metering</dt><dd>EBU R128</dd></div>
          <div><dt>Cross-check</dt><dd>pyloudnorm</dd></div>
          <div><dt>Beat stability</dt><dd>{classificationCopy(asString(beat.classification))}</dd></div>
        </dl>
      </section>

      <section className={styles.metricGrid} aria-label="Mastering measurements">
        <article><span>Integrated</span><strong>{metric(asNumber(loudness.integrated_lufs), " LUFS")}</strong><small>Programme loudness</small></article>
        <article><span>True peak</span><strong>{metric(asNumber(loudness.true_peak_dbtp), " dBTP", 2)}</strong><small>Reconstruction peak</small></article>
        <article><span>LRA</span><strong>{metric(asNumber(dynamics.loudness_range_lu), " LU")}</strong><small>Loudness range</small></article>
        <article><span>PLR</span><strong>{metric(asNumber(dynamics.peak_to_loudness_ratio_lu), " LU")}</strong><small>Peak-to-loudness ratio</small></article>
        <article><span>Crest</span><strong>{metric(asNumber(dynamics.crest_factor_db), " dB")}</strong><small>Peak vs RMS</small></article>
        <article><span>Stereo</span><strong>{metric(asNumber(stereo.correlation), "", 2)}</strong><small>L/R correlation</small></article>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}><div><span className="section-label">What needs attention</span><h3>Evidence, not a quality score</h3></div><small>{issues.filter((issue) => issue.severity !== "info").length} review item(s)</small></div>
        {issues.length ? (
          <div className={styles.issueList}>
            {issues.map((issue, index) => {
              const severity = asString(issue.severity) ?? "info";
              const startMs = asNumber(issue.start_ms);
              return (
                <article className={severity === "critical" ? styles.issueCritical : severity === "review" ? styles.issueReview : styles.issueInfo} key={`${asString(issue.code)}-${index}`}>
                  <div><small>{issueCategory(asString(issue.category))}</small><strong>{asString(issue.message) ?? "Review this master."}</strong></div>
                  {startMs !== null && audioUrl ? <button type="button" onClick={() => listenAt(startMs)}>▶ Listen at {time(startMs)}</button> : null}
                </article>
              );
            })}
          </div>
        ) : <p className={styles.muted}>No technical or platform issues were detected by the current checks.</p>}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}><div><span className="section-label">Beat stability</span><h3>{classificationCopy(asString(beat.classification))}</h3></div><small>{metric(asNumber(beat.confidence), " confidence", 2)}</small></div>
        <div className={styles.beatFacts}>
          <div><span>Median tempo</span><strong>{metric(asNumber(beat.median_bpm), " BPM", 2)}</strong></div>
          <div><span>Central 90%</span><strong>{asNumber(beat.p05_bpm) !== null && asNumber(beat.p95_bpm) !== null ? `${asNumber(beat.p05_bpm)!.toFixed(2)}–${asNumber(beat.p95_bpm)!.toFixed(2)} BPM` : "—"}</strong></div>
          <div><span>Tempo span</span><strong>{metric(asNumber(beat.central_90_span_bpm), " BPM", 2)}</strong></div>
          <div><span>End-to-end drift</span><strong>{asNumber(beat.estimated_end_to_end_drift_bpm) !== null ? `${signed(asNumber(beat.estimated_end_to_end_drift_bpm)!, 2)} BPM` : "—"}</strong></div>
          <div><span>Stable local windows</span><strong>{asNumber(beat.stable_ratio) !== null ? `${Math.round(asNumber(beat.stable_ratio)! * 100)}%` : "—"}</strong></div>
        </div>
        {beatTimeline.length ? (
          <div className={styles.beatChart}>
            <svg viewBox="0 0 1000 110" preserveAspectRatio="none" aria-label="Local tempo over time">
              <line x1="0" y1="95" x2="1000" y2="95" />
              <polyline points={beatPolyline(beatTimeline)} fill="none" vectorEffect="non-scaling-stroke" />
            </svg>
            <small>Robust local BPM from the canonical beat grid. Sudden half/double-time tracker aliases are normalized before stability judgment.</small>
          </div>
        ) : null}
        {beatChanges.length ? <div className={styles.changeList}>{beatChanges.map((change, index) => <span key={index}>{asString(change.from_section) ?? "Section"} → {asString(change.to_section) ?? "Section"}: {signed(asNumber(change.delta_bpm) ?? 0, 2)} BPM</span>)}</div> : null}
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.block}>
          <div className={styles.blockHead}><div><span className="section-label">Streaming preview</span><h3>Spotify Normal</h3></div></div>
          <dl className={styles.definitionList}>
            <div><dt>Playback target</dt><dd>{metric(asNumber(normalSpotify.target_lufs), " LUFS")}</dd></div>
            <div><dt>Estimated gain</dt><dd>{asNumber(normalSpotify.estimated_gain_db) !== null ? `${signed(asNumber(normalSpotify.estimated_gain_db)!, 1)} dB` : "—"}</dd></div>
            <div><dt>Post-gain peak</dt><dd>{metric(asNumber(normalSpotify.estimated_post_gain_true_peak_dbtp), " dBTP", 2)}</dd></div>
          </dl>
          <p className={styles.muted}>This previews playback normalization, not an exact Spotify encoder. Codec stress is measured separately.</p>
        </section>

        <section className={styles.block}>
          <div className={styles.blockHead}><div><span className="section-label">Delivery source</span><h3>File integrity</h3></div></div>
          <dl className={styles.definitionList}>
            <div><dt>Format</dt><dd>{asString(format.container) ?? "Unknown"} {asString(format.subtype) ?? ""}</dd></div>
            <div><dt>Bit depth</dt><dd>{asNumber(format.bit_depth) !== null ? `${asNumber(format.bit_depth)}-bit` : "Unknown"}</dd></div>
            <div><dt>Sample rate</dt><dd>{asNumber(format.sample_rate_hz) !== null ? `${(asNumber(format.sample_rate_hz)! / 1000).toFixed(1)} kHz` : "—"}</dd></div>
            <div><dt>Channels</dt><dd>{asNumber(format.channels) ?? "—"}</dd></div>
          </dl>
        </section>
      </div>

      <section className={styles.block}>
        <div className={styles.blockHead}><div><span className="section-label">Codec stress</span><h3>Does lossy reconstruction create new peak risk?</h3></div></div>
        <div className={styles.codecGrid}>
          {codecStress.map((codec, index) => (
            <article key={`${asString(codec.profile)}-${index}`}>
              <span>{(asString(codec.profile) ?? "Codec").replaceAll("_", " ")}</span>
              <strong>{asString(codec.status) === "completed" ? metric(asNumber(codec.true_peak_dbtp), " dBTP", 2) : "Unavailable"}</strong>
              <small>{asNumber(codec.true_peak_delta_db) !== null ? `${signed(asNumber(codec.true_peak_delta_db)!, 2)} dB vs source` : asString(codec.reason) ?? "No result"}</small>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}><div><span className="section-label">Reference intelligence</span><h3>Compare with {catalogProfiles.length ? `${catalogProfiles.length} analyzed catalog master${catalogProfiles.length === 1 ? "" : "s"}` : "your catalog"}</h3></div></div>
        {catalogProfiles.length ? (
          <>
            <div className={styles.referenceTable}>
              <div className={styles.referenceHeader}><span>Measurement</span><span>This master</span><span>Catalog median</span><span>Difference</span></div>
              {referenceRows.map(([label, key, suffix]) => {
                const current = asNumber(signature[key]);
                const reference = catalogMedian(catalogProfiles, key);
                return <div key={key}><span>{label}</span><strong>{metric(current, suffix, key === "true_peak_dbtp" ? 2 : 1)}</strong><span>{metric(reference, suffix, key === "true_peak_dbtp" ? 2 : 1)}</span><span>{current !== null && reference !== null ? `${signed(current - reference, 1)}${suffix}` : "—"}</span></div>;
              })}
            </div>
            <div className={styles.bandGrid}>
              {bands.map(([label, key, range]) => {
                const current = asNumber(currentBands[key]);
                const reference = catalogBands[key] ?? null;
                return <article key={key}><span>{label}</span><small>{range}</small><strong>{current !== null && reference !== null ? `${signed(current - reference, 1)} dB` : "—"}</strong><small>vs catalog spectral share</small></article>;
              })}
            </div>
            <p className={styles.muted}>Catalog differences are loudness-independent spectral/dynamic comparisons. They are never treated as defects by themselves.</p>
          </>
        ) : <p className={styles.muted}>When more analyzed masters exist for this artist, Ensemblis will compare this master against the artist's own released/unreleased mastering profile instead of using generic genre targets.</p>}
      </section>
    </div>
  );
}
