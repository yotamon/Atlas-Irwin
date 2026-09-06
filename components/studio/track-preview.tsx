"use client";

import { useRef, useState } from "react";
import styles from "./track-preview.module.css";

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

export function TrackPreview({
  src,
  startSeconds = 0,
  endSeconds,
  label = "Audio preview",
  compact = false,
}: {
  src: string;
  startSeconds?: number;
  endSeconds?: number;
  label?: string;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(endSeconds ?? 0);
  const [current, setCurrent] = useState(startSeconds);
  const [playing, setPlaying] = useState(false);
  const naturalEnd = endSeconds ?? duration;
  const effectiveEnd = Math.max(startSeconds + 0.1, naturalEnd > startSeconds ? naturalEnd : startSeconds + 0.1);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (audio.currentTime < startSeconds || audio.currentTime >= effectiveEnd - 0.05) {
      audio.currentTime = startSeconds;
      setCurrent(startSeconds);
    }
    void audio.play().catch(() => setPlaying(false));
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.max(startSeconds, Math.min(value, effectiveEnd));
    audio.currentTime = next;
    setCurrent(next);
  }

  return (
    <div className={`${styles.preview}${compact ? ` ${styles.compact}` : ""}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadStart={(event) => {
          event.currentTarget.pause();
          setCurrent(startSeconds);
          setPlaying(false);
          setDuration(endSeconds ?? 0);
        }}
        onLoadedMetadata={(event) => {
          const mediaDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
          setDuration(endSeconds ?? mediaDuration);
          event.currentTarget.currentTime = startSeconds;
          setCurrent(startSeconds);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const next = event.currentTarget.currentTime;
          if (endSeconds !== undefined && next >= endSeconds - 0.04) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = startSeconds;
            setCurrent(startSeconds);
            return;
          }
          setCurrent(next);
        }}
      />
      <button
        type="button"
        className={styles.play}
        onClick={togglePlayback}
        aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      >
        <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
      </button>
      <div className={styles.body}>
        <div className={styles.meta}>
          <strong>{label}</strong>
          <span>{formatTime(Math.max(0, current - startSeconds))} / {formatTime(Math.max(0, effectiveEnd - startSeconds))}</span>
        </div>
        <input
          aria-label={`Seek ${label}`}
          type="range"
          min={startSeconds}
          max={effectiveEnd}
          step="0.1"
          value={Math.max(startSeconds, Math.min(current, effectiveEnd))}
          onChange={(event) => seek(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
