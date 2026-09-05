"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analysisConfidenceLabel, hookRecommendationLabel } from "@/lib/studio/evidence-labels";
import { parseMusicMap } from "@/lib/video-director/creative-director";
import type { Json } from "@/types/database";
import styles from "./music-intelligence-preview.module.css";

function time(ms: number) {
  const seconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function downbeatCopy(source: string | undefined) {
  if (source === "model") return "detected downbeats";
  if (source === "inferred_from_beats") return "inferred bar grid";
  return "no verified downbeats";
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function sampleWaveform(buffer: AudioBuffer, bars = 196) {
  const count = Math.min(bars, Math.max(48, buffer.length));
  const blockSize = Math.max(1, Math.floor(buffer.length / count));
  const channels = Array.from(
    { length: Math.min(buffer.numberOfChannels, 2) },
    (_, index) => buffer.getChannelData(index),
  );
  const peaks = Array.from({ length: count }, (_, index) => {
    const start = index * blockSize;
    const end = index === count - 1 ? buffer.length : Math.min(buffer.length, start + blockSize);
    const stride = Math.max(1, Math.floor((end - start) / 96));
    let peak = 0;
    for (let sample = start; sample < end; sample += stride) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
    }
    return peak;
  });
  const ceiling = Math.max(...peaks, 0.0001);
  return peaks.map((peak) => clamp(peak / ceiling));
}

type WaveformState = {
  audioUrl: string;
  peaks: number[] | null;
  error: boolean;
};

export function MusicIntelligencePreview({
  audioUrl,
  musicMap,
}: {
  audioUrl: string | null;
  musicMap: Json;
}) {
  const map = parseMusicMap(musicMap);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [endMs, setEndMs] = useState<number | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waveformState, setWaveformState] = useState<WaveformState>({ audioUrl: "", peaks: null, error: false });
  const waveformPeaks = waveformState.audioUrl === audioUrl ? waveformState.peaks : null;
  const waveformError = waveformState.audioUrl === audioUrl && waveformState.error;
  const hooks = useMemo(
    () => [...(map?.hook_candidates ?? [])].sort((a, b) => b.score - a.score).slice(0, 5),
    [map],
  );

  useEffect(() => {
    if (!audioUrl) return;
    const controller = new AbortController();
    let audioContext: AudioContext | null = null;
    let cancelled = false;

    void fetch(audioUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Waveform audio request failed (${response.status}).`);
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return null;
        audioContext = new AudioContext();
        return audioContext.decodeAudioData(bytes);
      })
      .then((buffer) => {
        if (!buffer || cancelled) return;
        setWaveformState({ audioUrl, peaks: sampleWaveform(buffer), error: false });
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (!cancelled) setWaveformState({ audioUrl, peaks: null, error: true });
      })
      .finally(() => {
        if (audioContext && audioContext.state !== "closed") void audioContext.close();
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
    };
  }, [audioUrl]);

  if (!map || !Object.keys(map).length) return null;

  const durationMs = Math.max(
    1,
    map.duration_ms || map.sections.at(-1)?.end_ms || 1,
  );
  const energyPoints = map.energy_curve
    .filter((point) => Number.isFinite(point.ms) && Number.isFinite(point.value))
    .map((point) => `${(point.ms / durationMs) * 1000},${104 - clamp(point.value) * 92}`)
    .join(" ");
  const timelineSections = map.sections.filter((section) => section.end_ms > section.start_ms);
  const timelineEdits = map.edit_points
    .filter((point) => point.ms > 0 && point.ms < durationMs)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 24);
  const waveformProgress = clamp(currentMs / durationMs);

  function seekToRatio(ratio: number) {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const seconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationMs / 1000;
    const nextSeconds = clamp(ratio) * seconds;
    audio.currentTime = nextSeconds;
    setCurrentMs(nextSeconds * 1000);
    setEndMs(null);
    setActiveId(null);
  }

  function seekFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    seekToRatio((event.clientX - bounds.left) / bounds.width);
  }

  function toggle(id: string, startMs: number, stopMs: number) {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (activeId === id && playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setActiveId(id);
    setEndMs(stopMs);
    setCurrentMs(startMs);
    audio.currentTime = startMs / 1000;
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  const confidence = map.analysis?.confidence?.overall;
  const qc = map.master_qc;

  return (
    <div className={styles.preview}>
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onSeeked={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const nextMs = audio.currentTime * 1000;
          setCurrentMs(nextMs);
          if (endMs === null || nextMs < endMs - 30) return;
          audio.pause();
          setPlaying(false);
        }}
      />
      <div className={styles.head}>
        <div><small>Track Intelligence v{map.version}</small><strong>{map.bpm ? `${map.bpm} BPM` : "Analyzed track"}</strong></div>
        <span>{map.analysis?.quality === "full" ? "Semantic" : map.source === "worker" ? "Audio fallback" : "Estimated"}</span>
      </div>

      {map.version >= 3 ? (
        <p className={styles.note}>
          {typeof confidence === "number" ? `${analysisConfidenceLabel(confidence)} · ` : ""}
          {downbeatCopy(map.analysis?.downbeat_source ?? map.downbeat_source)}
          {map.analysis?.embeddings_used ? " · semantic recurrence" : ""}
          {qc ? ` · ${qc.technical_ready ? "master QC clear" : "master QC review"}` : ""}
        </p>
      ) : null}

      {audioUrl ? (
        <div className={styles.waveformBlock}>
          <div className={styles.timelineHeading}>
            <span>Waveform</span>
            <small>{waveformError ? "Waveform unavailable · playback still works" : waveformPeaks ? "Drag or use arrow keys to seek" : "Reading audio…"}</small>
          </div>
          <div
            className={`${styles.waveform}${waveformPeaks ? ` ${styles.waveformReady}` : ""}`}
            role="slider"
            tabIndex={0}
            aria-label="Seek audio waveform"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationMs)}
            aria-valuenow={Math.round(Math.min(currentMs, durationMs))}
            aria-valuetext={`${time(currentMs)} of ${time(durationMs)}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              seekFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              const audio = audioRef.current;
              const seconds = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationMs / 1000;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const direction = event.key === "ArrowLeft" ? -1 : 1;
                const current = audio?.currentTime ?? currentMs / 1000;
                seekToRatio((current + direction * 5) / seconds);
              } else if (event.key === "Home") {
                event.preventDefault();
                seekToRatio(0);
              } else if (event.key === "End") {
                event.preventDefault();
                seekToRatio(1);
              }
            }}
          >
            {waveformPeaks ? (
              <div className={styles.waveformBars} aria-hidden="true">
                {waveformPeaks.map((peak, index) => (
                  <i
                    key={index}
                    className={(index + 1) / waveformPeaks.length <= waveformProgress ? styles.waveformPlayed : ""}
                    style={{ height: `${Math.max(10, Math.round(peak * 100))}%` }}
                  />
                ))}
              </div>
            ) : <span className={styles.waveformSkeleton} aria-hidden="true" />}
          </div>
        </div>
      ) : null}

      <div className={styles.timelineBlock}>
        <div className={styles.timelineHeading}>
          <span>Musical timeline</span>
          <small>{time(durationMs)}</small>
        </div>
        <div className={styles.timeline} aria-label="Track energy, structure and ranked hook windows">
          <svg viewBox="0 0 1000 112" preserveAspectRatio="none" aria-hidden="true">
            <line className={styles.timelineBaseline} x1="0" y1="104" x2="1000" y2="104" />
            {energyPoints ? <polyline className={styles.energyLine} points={energyPoints} fill="none" vectorEffect="non-scaling-stroke" /> : null}
            {timelineEdits.map((point) => {
              const x = (point.ms / durationMs) * 1000;
              return <line className={styles.editLine} key={`${point.ms}-${point.reason}`} x1={x} y1="8" x2={x} y2="106" vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          <div className={styles.sectionOverlay} aria-hidden="true">
            {timelineSections.map((section) => {
              const left = clamp(section.start_ms / durationMs) * 100;
              const width = Math.max(0.8, clamp((section.end_ms - section.start_ms) / durationMs) * 100);
              return <span key={section.id} style={{ left: `${left}%`, width: `${width}%` }} title={`${section.label} · ${time(section.start_ms)}–${time(section.end_ms)}`}><b>{width >= 8 ? section.label : ""}</b></span>;
            })}
          </div>
          <div className={styles.hookOverlay} aria-hidden="true">
            {hooks.slice(0, 3).map((hook, index) => {
              const left = clamp(hook.start_ms / durationMs) * 100;
              const width = Math.max(0.7, clamp((hook.end_ms - hook.start_ms) / durationMs) * 100);
              return <span key={hook.id} style={{ left: `${left}%`, width: `${width}%` }} title={`Hook ${index + 1}: ${hook.label}`} />;
            })}
          </div>
          {audioUrl ? <span className={styles.playhead} aria-hidden="true" style={{ left: `${clamp(currentMs / durationMs) * 100}%` }} /> : null}
        </div>
      </div>

      <div className={styles.sections} aria-label="Playable track sections">
        {map.sections.map((section) => (
          <button
            type="button"
            key={section.id}
            className={activeId === section.id ? styles.active : ""}
            style={{ flexGrow: Math.max(1, section.end_ms - section.start_ms) }}
            onClick={() => toggle(section.id, section.start_ms, section.end_ms)}
            disabled={!audioUrl}
          >
            <strong>{activeId === section.id && playing ? "❚❚" : "▶"} {section.label}</strong>
            <small>{time(section.start_ms)}–{time(section.end_ms)}</small>
          </button>
        ))}
      </div>

      {hooks.length ? (
        <div className={styles.hooks}>
          <div className={styles.hookHeading}><span>Strongest moments</span><small>play ranked windows</small></div>
          {hooks.map((hook, index) => {
            const topIntent = Object.entries(hook.intent_scores ?? {})
              .filter((entry): entry is [string, number] => typeof entry[1] === "number")
              .sort((a, b) => b[1] - a[1])[0];
            return (
              <button
                type="button"
                key={hook.id}
                className={activeId === hook.id ? styles.activeHook : ""}
                onClick={() => toggle(hook.id, hook.start_ms, hook.end_ms)}
                disabled={!audioUrl}
              >
                <span>{activeId === hook.id && playing ? "❚❚" : "▶"}</span>
                <div><strong>#{index + 1} {hook.label}</strong><small>{time(hook.start_ms)}–{time(hook.end_ms)} · {topIntent ? topIntent[0].replaceAll("_", " ") : hook.kind.replaceAll("_", " ")}</small></div>
                <b>{hookRecommendationLabel(hook.score, index)}</b>
              </button>
            );
          })}
        </div>
      ) : (
        <p className={styles.note}>{map.source === "worker" && map.version < 3 ? "Legacy analysis. Re-analyze this track to get v3 production moments and ranked alternatives." : "No strong moment candidates are available for this map."}</p>
      )}
      {!audioUrl ? <p className={styles.note}>Attach an audio master to enable section and hook playback.</p> : null}
    </div>
  );
}