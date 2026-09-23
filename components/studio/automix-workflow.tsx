"use client";

import { useEffect, useMemo, useState } from "react";
import { AutoMixRenderRecovery } from "@/components/studio/automix-render-recovery";
import { ConnectionWidget } from "@/components/studio/ux-v4-widgets";
import { DjIntelligencePanel } from "@/components/studio/dj-intelligence-panel";
import { LibraryBridgePanel } from "@/components/studio/library-bridge-panel";
import { LocalSetBuilderWorkspace } from "@/components/studio/local-set-builder-workspace";
import { RekordboxImportPanel } from "@/components/studio/rekordbox-import-panel";
import { SetBuilderWorkspace } from "@/components/studio/set-builder-workspace";

type TrackOption = {
  id: string;
  title: string;
  release_id: string;
  audio_url: string | null;
  is_primary: boolean;
};

type Device = {
  id: string;
  name: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

type Source = "local" | "catalog";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
export function AutoMixWorkflow({
  artistId,
  artistName,
  tracks,
  initialSource,
  initialTrackIds,
  initialMixId,
}: {
  artistId: string;
  artistName: string;
  tracks: TrackOption[];
  initialSource?: Source;
  initialTrackIds?: string[];
  initialMixId?: string;
}) {
  const [source, setSource] = useState<Source | null>(initialSource ?? null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceStateLoaded, setDeviceStateLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/studio/dj-library/devices?artistId=${encodeURIComponent(artistId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => ({
        response,
        body: await response.json().catch(() => null),
      }))
      .then(({ response, body }) => {
        if (!response.ok || controller.signal.aborted) return;
        const list = record(body).devices;
        setDevices(Array.isArray(list) ? list as Device[] : []);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDeviceStateLoaded(true);
      });
    return () => controller.abort();
  }, [artistId]);

  const activeDevices = useMemo(() => devices.filter((device) => !device.revoked_at), [devices]);
  const connectedDevice = activeDevices[0] ?? null;
  const masteredTracks = tracks.filter((track) => Boolean(track.audio_url));
  if (!source) {
    return (
      <section className="en-automix-source-step" aria-labelledby="automix-source-heading">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">1 / Music</span>
            <h2 id="automix-source-heading">Where should the music come from?</h2>
            <p>Choose the library you want to mix. Ensemblis keeps the workflow the same either way.</p>
          </div>
        </div>

        <div className="en-automix-source-grid">
          <button type="button" className="en-automix-source-card" onClick={() => setSource("local")}>
            <span>This computer</span>
            <strong>{connectedDevice?.name || "Local music library"}</strong>
            <small>
              {connectedDevice
                ? "Use locally analyzed tracks and render on your processor."
                : deviceStateLoaded
                  ? "Connect Ensemblis Desktop to use local music."
                  : "Checking your computer connection…"}
            </small>
            <b>{connectedDevice ? "Use this computer →" : "Set up local library →"}</b>
          </button>

          <button type="button" className="en-automix-source-card" onClick={() => setSource("catalog")} disabled={masteredTracks.length < 2}>
            <span>Ensemblis catalog</span>
            <strong>{masteredTracks.length} mastered tracks</strong>
            <small>Use music already stored in the Ensemblis catalog.</small>
            <b>{masteredTracks.length >= 2 ? "Use catalog →" : "Add at least two masters first"}</b>
          </button>
        </div>
      </section>
    );
  }
  return (
    <div className="en-automix-workflow">
      <div className="en-automix-workflow-context">
        <button type="button" className="text-button" onClick={() => setSource(null)}>← Change music source</button>
        {source === "local" ? (
          <ConnectionWidget
            connected={Boolean(connectedDevice)}
            name={connectedDevice?.name || "This computer"}
            detail={connectedDevice ? "Local analysis and final rendering stay on this computer." : "Connect Ensemblis Desktop before building a local mix."}
          />
        ) : (
          <ConnectionWidget
            connected={masteredTracks.length >= 2}
            name="Ensemblis catalog"
            detail={`${masteredTracks.length} mastered track${masteredTracks.length === 1 ? "" : "s"} available for mixing.`}
          />
        )}
      </div>

      {source === "local" ? (
        <LocalSetBuilderWorkspace artistId={artistId} artistName={artistName} initialMixId={initialMixId} />
      ) : (
        <SetBuilderWorkspace
          artistId={artistId}
          artistName={artistName}
          tracks={tracks}
          initialTrackIds={initialTrackIds}
          initialMixId={initialMixId}
        />
      )}

      <AutoMixRenderRecovery artistId={artistId} />

      <details className="v2-advanced-disclosure en-automix-advanced">
        <summary>DJ preferences & connection tools</summary>
        <p className="v2-muted-copy">Only open these when you want to tune how Ensemblis mixes or repair a library connection.</p>
        <div className="en-automix-advanced-stack">
          <DjIntelligencePanel artistId={artistId} />
          <LibraryBridgePanel artistId={artistId} />
          <RekordboxImportPanel artistId={artistId} />
        </div>
      </details>
    </div>
  );
}
