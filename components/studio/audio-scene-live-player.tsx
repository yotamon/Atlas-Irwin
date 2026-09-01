"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FiPause, FiPlay } from "react-icons/fi";
import styles from "./audio-scene-live-player.module.css";
import type { Json } from "@/types/database";

export type AudioSceneLiveStem = {
  id: string;
  label: string;
  url: string;
  offsetMs: number;
};

type ResolvedLayer = {
  key: string;
  label: string;
  url: string;
  gainDb: number;
  sourceOffsetMs: number;
  startAtMs: number;
  endAtMs: number;
  fadeInMs: number;
  fadeOutMs: number;
};

type LayerGraph = {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function clock(ms: number) {
  const seconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function metadataReady(element: HTMLAudioElement) {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Audio source took too long to become playable.")), 10000);
    const done = () => {
      window.clearTimeout(timeout);
      element.removeEventListener("loadedmetadata", done);
      element.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      window.clearTimeout(timeout);
      element.removeEventListener("loadedmetadata", done);
      element.removeEventListener("error", failed);
      reject(new Error("One of the Audio Scene sources could not be loaded."));
    };
    element.addEventListener("loadedmetadata", done, { once: true });
    element.addEventListener("error", failed, { once: true });
    element.load();
  });
}

export function AudioSceneLivePlayer({
  recipe,
  startMs,
  endMs,
  masterUrl,
  stems,
  compact = false,
}: {
  recipe: Json;
  startMs: number;
  endMs: number;
  masterUrl?: string | null;
  stems: AudioSceneLiveStem[];
  compact?: boolean;
}) {
  const instanceId = useId();
  const durationMs = Math.max(1, endMs - startMs);
  const stemById = useMemo(() => new Map(stems.map((stem) => [stem.id, stem])), [stems]);
  const layers = useMemo<ResolvedLayer[]>(() => {
    const rows = record(recipe).layers;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((value, index) => {
      const row = record(value);
      const source = row.source;
      let url = "";
      let label = "";
      let sourceOffsetMs = 0;
      if (source === "master" && masterUrl) {
        url = masterUrl;
        label = "Canonical master";
      } else if (source === "stem" && typeof row.stem_id === "string") {
        const stem = stemById.get(row.stem_id);
        if (!stem) return [];
        url = stem.url;
        label = stem.label;
        sourceOffsetMs = stem.offsetMs;
      } else {
        return [];
      }
      return [{
        key: `${source}:${typeof row.stem_id === "string" ? row.stem_id : "master"}:${index}`,
        label,
        url,
        gainDb: finite(row.gain_db, 0),
        sourceOffsetMs,
        startAtMs: Math.max(0, finite(row.start_at_ms, 0)),
        endAtMs: Math.max(0, Math.min(durationMs, finite(row.end_at_ms, durationMs))),
        fadeInMs: Math.max(0, finite(row.fade_in_ms, 0)),
        fadeOutMs: Math.max(0, finite(row.fade_out_ms, 0)),
      }];
    }).filter((layer) => layer.endAtMs > layer.startAtMs);
  }, [durationMs, masterUrl, recipe, stemById]);

  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const graphs = useRef(new Map<string, LayerGraph>());
  const contextRef = useRef<AudioContext | null>(null);
  const busRef = useRef<DynamicsCompressorNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const basePositionRef = useRef(0);
  const startedAtRef = useRef(0);
  const lastUiRef = useRef(0);
  const lastSyncRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [error, setError] = useState("");

  function expectedSourceMs(layer: ResolvedLayer, position: number) {
    return startMs + position - layer.sourceOffsetMs;
  }

  function layerGain(layer: ResolvedLayer, position: number) {
    const sourceMs = expectedSourceMs(layer, position);
    if (sourceMs < 0 || position < layer.startAtMs || position >= layer.endAtMs) return 0;
    let fade = 1;
    if (layer.fadeInMs > 0) fade = Math.min(fade, (position - layer.startAtMs) / layer.fadeInMs);
    if (layer.fadeOutMs > 0) fade = Math.min(fade, (layer.endAtMs - position) / layer.fadeOutMs);
    return dbToGain(layer.gainDb) * Math.max(0, Math.min(1, fade));
  }

  async function ensureGraph() {
    if (!contextRef.current) {
      const AudioContextCtor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("This browser does not support live Audio Scene mixing.");
      const context = new AudioContextCtor();
      const bus = context.createDynamicsCompressor();
      bus.threshold.value = -1;
      bus.knee.value = 0;
      bus.ratio.value = 20;
      bus.attack.value = 0.003;
      bus.release.value = 0.08;
      bus.connect(context.destination);
      contextRef.current = context;
      busRef.current = bus;
    }
    const context = contextRef.current;
    const bus = busRef.current;
    if (!context || !bus) throw new Error("Could not initialize the live Audio Scene mixer.");
    for (const layer of layers) {
      const element = audioRefs.current.get(layer.key);
      if (!element) continue;
      const existing = graphs.current.get(layer.key);
      if (existing?.element === element) continue;
      if (existing) {
        existing.source.disconnect();
        existing.gain.disconnect();
        graphs.current.delete(layer.key);
      }
      const source = context.createMediaElementSource(element);
      const gain = context.createGain();
      source.connect(gain).connect(bus);
      graphs.current.set(layer.key, { element, source, gain });
    }
    await context.resume();
  }

  function applyGains(position: number) {
    const context = contextRef.current;
    if (!context) return;
    for (const layer of layers) {
      const graph = graphs.current.get(layer.key);
      if (!graph) continue;
      graph.gain.gain.setValueAtTime(layerGain(layer, position), context.currentTime);
    }
  }

  async function alignSources(position: number, shouldPlay: boolean) {
    await Promise.all(layers.map(async (layer) => {
      const element = audioRefs.current.get(layer.key);
      if (!element) return;
      await metadataReady(element);
      const expectedMs = expectedSourceMs(layer, position);
      if (expectedMs < 0) {
        element.pause();
        element.currentTime = 0;
        return;
      }
      const expectedSeconds = expectedMs / 1000;
      const maxTime = Number.isFinite(element.duration) ? Math.max(0, element.duration - 0.01) : expectedSeconds;
      element.currentTime = Math.min(expectedSeconds, maxTime);
      if (shouldPlay) await element.play();
    }));
  }

  function pause(reset = false) {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (playingRef.current && !reset) {
      basePositionRef.current = Math.min(durationMs, basePositionRef.current + performance.now() - startedAtRef.current);
    }
    playingRef.current = false;
    for (const element of audioRefs.current.values()) element.pause();
    const next = reset ? 0 : basePositionRef.current;
    if (reset) basePositionRef.current = 0;
    applyGains(next);
    setPositionMs(next);
    setPlaying(false);
  }

  function tick() {
    if (!playingRef.current) return;
    const now = performance.now();
    const position = basePositionRef.current + now - startedAtRef.current;
    if (position >= durationMs) {
      pause(true);
      return;
    }
    applyGains(position);
    if (now - lastUiRef.current > 70) {
      setPositionMs(position);
      lastUiRef.current = now;
    }
    if (now - lastSyncRef.current > 900) {
      for (const layer of layers) {
        const element = audioRefs.current.get(layer.key);
        if (!element) continue;
        const expectedMs = expectedSourceMs(layer, position);
        if (expectedMs < 0) {
          element.pause();
          continue;
        }
        const expectedSeconds = expectedMs / 1000;
        if (element.paused) {
          element.currentTime = expectedSeconds;
          void element.play().catch(() => undefined);
        } else if (Math.abs(element.currentTime - expectedSeconds) > 0.14) {
          element.currentTime = expectedSeconds;
        }
      }
      lastSyncRef.current = now;
    }
    frameRef.current = requestAnimationFrame(tick);
  }

  async function play() {
    if (!layers.length) {
      setError("This scene has no playable sources yet.");
      return;
    }
    setError("");
    try {
      window.dispatchEvent(new CustomEvent("atlas-audio-scene-play", { detail: instanceId }));
      await ensureGraph();
      await alignSources(basePositionRef.current, true);
      applyGains(basePositionRef.current);
      playingRef.current = true;
      startedAtRef.current = performance.now();
      lastUiRef.current = 0;
      lastSyncRef.current = 0;
      setPlaying(true);
      frameRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      pause(false);
      setError(cause instanceof Error ? cause.message : "Could not start the live Audio Scene.");
    }
  }

  async function seek(next: number) {
    const bounded = Math.max(0, Math.min(durationMs, next));
    basePositionRef.current = bounded;
    setPositionMs(bounded);
    applyGains(bounded);
    try {
      await alignSources(bounded, playingRef.current);
      if (playingRef.current) startedAtRef.current = performance.now();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not seek the live Audio Scene.");
    }
  }

  useEffect(() => {
    const stopOtherPlayer = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== instanceId && playingRef.current) pause(false);
    };
    window.addEventListener("atlas-audio-scene-play", stopOtherPlayer);
    return () => {
      window.removeEventListener("atlas-audio-scene-play", stopOtherPlayer);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      for (const element of audioRefs.current.values()) element.pause();
      for (const graph of graphs.current.values()) {
        graph.source.disconnect();
        graph.gain.disconnect();
      }
      graphs.current.clear();
      void contextRef.current?.close();
    };
    // pause() deliberately reads the latest refs; re-registering this global listener on every render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    pause(true);
    // Keep existing MediaElementSource nodes attached. Browsers allow only one source node per media element.
    // ensureGraph() reconnects only when React has actually replaced an element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, startMs, endMs]);

  return (
    <div className={`${styles.player} audio-scene-live-player${compact ? ` ${styles.compact} compact` : ""}`}>
      {layers.map((layer) => (
        <audio
          key={layer.key}
          ref={(element) => {
            if (element) audioRefs.current.set(layer.key, element);
            else audioRefs.current.delete(layer.key);
          }}
          crossOrigin="anonymous"
          preload="metadata"
          src={layer.url}
          aria-label={layer.label}
          hidden
        />
      ))}
      <div className={`${styles.controls} audio-scene-live-controls`}>
        <button
          type="button"
          className="button"
          onClick={() => playing ? pause(false) : void play()}
          disabled={!layers.length}
        >
          {playing ? <><FiPause /> Pause live mix</> : <><FiPlay /> Play live mix</>}
        </button>
        <span className={styles.status}><strong>Live from stems</strong><small>{layers.length} layer{layers.length === 1 ? "" : "s"}</small></span>
      </div>
      <input
        className={styles.range}
        type="range"
        min={0}
        max={durationMs}
        step={50}
        value={Math.min(durationMs, positionMs)}
        aria-label="Audio Scene position"
        onChange={(event) => void seek(Number(event.target.value))}
        disabled={!layers.length}
      />
      <div className={`${styles.time} audio-scene-live-time`}>
        <span>{clock(startMs + positionMs)}</span>
        <span>{clock(endMs)}</span>
      </div>
      {error ? <div className="notice compact-notice">{error}</div> : null}
    </div>
  );
}
