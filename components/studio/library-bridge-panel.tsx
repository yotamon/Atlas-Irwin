"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiCheck,
  FiClipboard,
  FiHardDrive,
  FiLink,
  FiRefreshCw,
  FiShield,
  FiTrash2,
} from "react-icons/fi";
import styles from "./library-bridge-panel.module.css";

type Device = {
  id: string;
  public_id: string;
  name: string;
  platform: string;
  app_version: string;
  credential_prefix: string;
  capabilities: Record<string, boolean>;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

type Source = {
  id: string;
  device_id: string;
  source_id: string;
  source_kind: string;
  revision: string | null;
  track_count: number;
  last_synced_at: string | null;
};

type Snapshot = { devices: Device[]; sources: Source[] };
type Pairing = { code: string; expiresAt: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function relativeTime(value: string | null, referenceMs: number) {
  if (!value) return "Never";
  const seconds = Math.max(0, Math.round((referenceMs - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function sourceLabel(kind: string) {
  if (kind === "local_library") return "Music folder";
  if (kind === "rekordbox") return "Rekordbox";
  if (kind === "traktor") return "Traktor";
  return kind;
}

export function LibraryBridgePanel({ artistId }: { artistId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ devices: [], sources: [] });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [observedAtMs, setObservedAtMs] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/studio/dj-library/devices?artistId=${encodeURIComponent(artistId)}`, {
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(String(record(body).error || "Could not load connected computers."));
    setSnapshot({
      devices: Array.isArray(record(body).devices) ? record(body).devices as Device[] : [],
      sources: Array.isArray(record(body).sources) ? record(body).sources as Source[] : [],
    });
    setObservedAtMs(Date.now());
  }, [artistId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void load(controller.signal)
        .catch((error) => {
          if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Could not load connected computers.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeDevices = useMemo(
    () => snapshot.devices.filter((device) => !device.revoked_at),
    [snapshot.devices],
  );

  async function createPairing() {
    if (busy) return;
    setBusy("pairing");
    setStatus("");
    setCopied(false);
    try {
      const response = await fetch("/api/studio/dj-library/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_pairing", artistId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(record(body).error || "Could not create a manual connection code."));
      setPairing({ code: String(record(body).code), expiresAt: String(record(body).expiresAt) });
      setStatus("Manual connection code created. Use it only from Ensemblis desktop Settings → Advanced connection options.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create a manual connection code.");
    } finally {
      setBusy("");
    }
  }

  async function copyPairing() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.code);
    setCopied(true);
  }

  async function revoke(device: Device) {
    if (busy) return;
    const confirmed = window.confirm(
      `Disconnect ${device.name}? It will stop syncing with Ensemblis. Your local music files will not be deleted.`,
    );
    if (!confirmed) return;
    setBusy(device.id);
    setStatus("");
    try {
      const response = await fetch("/api/studio/dj-library/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", artistId, deviceId: device.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(record(body).error || "Could not disconnect this computer."));
      setStatus(`${device.name} disconnected.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not disconnect this computer.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.panel} aria-label="Connected computers">
      <div className={styles.header}>
        <div>
          <span className="section-label">Music / Computers</span>
          <h2>Your connected computers</h2>
          <p>
            The Ensemblis desktop app securely gives your workspace access to music stored on your computers. Connect a new computer from the desktop app itself; it will open the browser here for approval automatically.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className="button" type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
            <FiRefreshCw aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className={styles.securityStrip}>
        <FiShield aria-hidden="true" />
        <div>
          <strong>Your music stays local</strong>
          <span>Original audio and folder locations stay on your computer. Ensemblis receives only the music information needed by your workspace.</span>
        </div>
      </div>

      <div className={styles.devices}>
        {loading ? <p className={styles.empty}>Loading connected computers…</p> : null}
        {!loading && activeDevices.length === 0 ? (
          <div className={styles.emptyState}>
            <FiHardDrive aria-hidden="true" />
            <div>
              <strong>No computer connected yet</strong>
              <p>Open the Ensemblis desktop app on the computer that holds your music and choose “Connect to Ensemblis.” The rest happens automatically.</p>
            </div>
          </div>
        ) : null}
        {activeDevices.map((device) => {
          const sources = snapshot.sources.filter((source) => source.device_id === device.id);
          const recent = device.last_seen_at
            ? observedAtMs - new Date(device.last_seen_at).getTime() < 2 * 60 * 1000
            : false;
          return (
            <article className={styles.device} key={device.id}>
              <div className={styles.deviceTop}>
                <div>
                  <div className={styles.deviceTitleRow}>
                    <strong>{device.name}</strong>
                    <span className={recent ? styles.online : styles.offline}>{recent ? "Online" : "Offline"}</span>
                  </div>
                  <span className={styles.meta}>{device.platform} · Ensemblis {device.app_version} · last seen {relativeTime(device.last_seen_at, observedAtMs)}</span>
                </div>
                <button
                  className={styles.dangerButton}
                  type="button"
                  onClick={() => revoke(device)}
                  disabled={Boolean(busy)}
                  title="Disconnect computer"
                >
                  <FiTrash2 aria-hidden="true" /> Disconnect
                </button>
              </div>

              <div className={styles.sourceGrid}>
                {sources.length === 0 ? <p className={styles.sourceEmpty}>Connected. Waiting for the first music folder.</p> : null}
                {sources.map((source) => (
                  <div className={styles.source} key={source.id}>
                    <span>{sourceLabel(source.source_kind)}</span>
                    <strong>{source.track_count.toLocaleString()} tracks</strong>
                    <small>{source.last_synced_at ? `Updated ${relativeTime(source.last_synced_at, observedAtMs)}` : "Preparing…"}</small>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <details className={styles.device}>
        <summary><FiLink aria-hidden="true" /> Manual connection</summary>
        <div className={styles.devices}>
          <div>
            <strong>Only use this if browser connection is unavailable.</strong>
            <p>Generate a temporary code and enter it in Ensemblis desktop under Settings → Advanced connection options.</p>
          </div>
          <button className="button" type="button" onClick={createPairing} disabled={Boolean(busy)}>
            {busy === "pairing" ? "Creating…" : "Create temporary code"}
          </button>
          {pairing ? (
            <div className={styles.pairingCard}>
              <div>
                <span className={styles.kicker}>Temporary code</span>
                <strong className={styles.pairingCode}>{pairing.code}</strong>
                <span className={styles.expiry}>Expires {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <button className="button" type="button" onClick={copyPairing}>
                {copied ? <FiCheck aria-hidden="true" /> : <FiClipboard aria-hidden="true" />}
                {copied ? "Copied" : "Copy code"}
              </button>
            </div>
          ) : null}
        </div>
      </details>

      {status ? <p className={styles.status} role="status">{status}</p> : null}
    </section>
  );
}
