"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCustomAudioScene } from "@/app/studio/stem-actions-safe";
import { AudioSceneLivePlayer } from "@/components/studio/audio-scene-live-player";
import { STEM_CATEGORY_LABELS } from "@/lib/music-intelligence/stems";
import type { Json } from "@/types/database";
import type { StemCategory } from "@/types/stem-database";

type MixerStem = {
  id: string;
  label: string;
  category: StemCategory;
  url: string;
  offsetMs: number;
};

type LayerState = {
  enabled: boolean;
  gainDb: number;
};

export function StemCustomMixer({
  trackId,
  stems,
  defaultStartMs = 0,
  defaultEndMs = 15000,
}: {
  trackId: string;
  stems: MixerStem[];
  defaultStartMs?: number;
  defaultEndMs?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("Custom Scene");
  const [startSeconds, setStartSeconds] = useState(Math.max(0, defaultStartMs / 1000));
  const [durationSeconds, setDurationSeconds] = useState(Math.max(1, (defaultEndMs - defaultStartMs) / 1000));
  const [message, setMessage] = useState("");
  const [layers, setLayers] = useState<Record<string, LayerState>>(() => Object.fromEntries(
    stems.map((stem) => [stem.id, { enabled: true, gainDb: 0 }]),
  ));

  const activeCount = useMemo(
    () => stems.filter((stem) => layers[stem.id]?.enabled).length,
    [layers, stems],
  );

  const recipe = useMemo(() => ({
    schema: "atlas.audio_scene.v1",
    mix_mode: "layers",
    layers: stems
      .filter((stem) => layers[stem.id]?.enabled)
      .map((stem) => ({
        source: "stem",
        stem_id: stem.id,
        category: stem.category,
        gain_db: layers[stem.id]?.gainDb ?? 0,
      })),
    limiter: { enabled: true, ceiling_db: -1 },
  }) as Json, [layers, stems]);

  function patch(stemId: string, values: Partial<LayerState>) {
    setLayers((current) => ({
      ...current,
      [stemId]: { ...(current[stemId] ?? { enabled: true, gainDb: 0 }), ...values },
    }));
  }

  function submit() {
    setMessage("");
    if (!activeCount) {
      setMessage("Keep at least one stem in the scene.");
      return;
    }
    const form = new FormData();
    form.set("track_id", trackId);
    form.set("name", name.trim() || "Custom Scene");
    form.set("recipe", JSON.stringify(recipe));
    form.set("start_ms", String(Math.max(0, Math.round(startSeconds * 1000))));
    form.set("end_ms", String(Math.max(1, Math.round((startSeconds + durationSeconds) * 1000))));
    startTransition(async () => {
      try {
        await saveCustomAudioScene(form);
        setMessage("Custom Audio Scene saved. You can keep auditioning it live; create an audio file only when export or publishing needs one.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save the custom Audio Scene.");
      }
    });
  }

  return (
    <div className="stem-custom-mixer">
      <div className="stem-mixer-header">
        <div>
          <span className="section-label">Advanced</span>
          <h3>Build a custom Audio Scene</h3>
          <p>Override Ensemblis only when you want a specific stem balance. The recipe stays non-destructive and is audible immediately.</p>
        </div>
        <span>{activeCount}/{stems.length} layers</span>
      </div>

      <div className="stem-mixer-meta">
        <label className="field">
          <span>Scene name</span>
          <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Start (seconds)</span>
          <input type="number" min="0" step="0.1" value={startSeconds} onChange={(event) => setStartSeconds(Math.max(0, Number(event.target.value) || 0))} />
        </label>
        <label className="field">
          <span>Duration (seconds)</span>
          <input type="number" min="1" max="120" step="0.1" value={durationSeconds} onChange={(event) => setDurationSeconds(Math.max(1, Math.min(120, Number(event.target.value) || 1)))} />
        </label>
      </div>

      <AudioSceneLivePlayer
        compact
        recipe={recipe}
        startMs={Math.max(0, Math.round(startSeconds * 1000))}
        endMs={Math.max(1, Math.round((startSeconds + durationSeconds) * 1000))}
        stems={stems.map((stem) => ({ id: stem.id, label: stem.label, url: stem.url, offsetMs: stem.offsetMs }))}
      />

      <div className="stem-mixer-layers">
        {stems.map((stem) => {
          const layer = layers[stem.id] ?? { enabled: true, gainDb: 0 };
          return (
            <div className={layer.enabled ? "stem-mixer-layer" : "stem-mixer-layer muted"} key={stem.id}>
              <label className="stem-mixer-toggle">
                <input type="checkbox" checked={layer.enabled} onChange={(event) => patch(stem.id, { enabled: event.target.checked })} />
                <span><strong>{stem.label}</strong><small>{STEM_CATEGORY_LABELS[stem.category]}</small></span>
              </label>
              <input
                type="range"
                min="-36"
                max="6"
                step="1"
                disabled={!layer.enabled}
                value={layer.gainDb}
                aria-label={`${stem.label} gain`}
                onChange={(event) => patch(stem.id, { gainDb: Number(event.target.value) })}
              />
              <output>{layer.enabled ? `${layer.gainDb > 0 ? "+" : ""}${layer.gainDb} dB` : "Muted"}</output>
            </div>
          );
        })}
      </div>

      <div className="stem-mixer-actions">
        <button type="button" className="button primary" disabled={pending || !stems.length} onClick={submit}>
          {pending ? "Saving…" : "Save custom scene"}
        </button>
        {message ? <span aria-live="polite">{message}</span> : <span>Audition is live. Saving stores only the recipe, not another audio file.</span>}
      </div>
    </div>
  );
}
