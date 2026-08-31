"use client";

import { useMemo, useRef, useState } from "react";
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
  const [playing, setPlaying] = useState(false);
  const hooks = useMemo(
    () => [...(map?.hook_candidates ?? [])].sort((a, b) => b.score - a.score).slice(0, 5),
    [map],
  );

  if (!map || !Object.keys(map).length) return null;

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
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio || endMs === null || audio.currentTime * 1000 < endMs - 30) return;
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
          {typeof confidence === "number" ? `${Math.round(confidence * 100)}% analysis confidence · ` : ""}
          {downbeatCopy(map.analysis?.downbeat_source ?? map.downbeat_source)}
          {map.analysis?.embeddings_used ? " · semantic recurrence" : ""}
          {qc ? ` · ${qc.technical_ready ? "master QC clear" : "master QC review"}` : ""}
        </p>
      ) : null}

      <div className={styles.sections}>
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
                <div><strong>#{index + 1} {hook.label}</strong><small>{time(hook.start_ms)}–{time(hook.end_ms)} · {topIntent ? `${topIntent[0].replaceAll("_", " ")} ${Math.round(topIntent[1] * 100)}` : hook.kind.replaceAll("_", " ")}</small></div>
                <b>{Math.round(hook.score * 100)}</b>
              </button>
            );
          })}
        </div>
      ) : (
        <p className={styles.note}>{map.source === "worker" && map.version < 3 ? "Legacy analysis. Re-analyze this track to get v3 production moments and ranked alternatives." : "No scored hook candidates are available for this map."}</p>
      )}
      {!audioUrl ? <p className={styles.note}>Attach an audio master to enable section and hook playback.</p> : null}
    </div>
  );
}
