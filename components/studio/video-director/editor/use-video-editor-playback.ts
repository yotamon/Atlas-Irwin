"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PlaybackLoopRange = { startMs: number; endMs: number } | null;

export function useVideoEditorPlayback(input: {
  durationMs: number;
  loopRange: PlaybackLoopRange;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastPaintRef = useRef(0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const seek = useCallback((ms: number) => {
    const next = Math.max(0, Math.min(input.durationMs, ms));
    setPlayheadMs(next);
    if (audioRef.current) audioRef.current.currentTime = next / 1000;
  }, [input.durationMs]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play(); else audio.pause();
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      return;
    }
    const tick = (timestamp: number) => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      let currentMs = audio.currentTime * 1000;
      const loop = input.loopRange;
      if (loop && loop.endMs > loop.startMs && currentMs >= loop.endMs) {
        currentMs = loop.startMs;
        audio.currentTime = currentMs / 1000;
      }
      if (timestamp - lastPaintRef.current >= 30) {
        setPlayheadMs(Math.max(0, Math.min(input.durationMs, currentMs)));
        lastPaintRef.current = timestamp;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [input.durationMs, input.loopRange, isPlaying]);

  return {
    audioRef,
    playheadMs,
    isPlaying,
    seek,
    togglePlayback,
    audioProps: {
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onEnded: () => setIsPlaying(false),
      onSeeked: (event: React.SyntheticEvent<HTMLAudioElement>) => setPlayheadMs(event.currentTarget.currentTime * 1000),
    },
  };
}
