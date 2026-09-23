"use client";

import { useState } from "react";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import styles from "./library-bridge-connect.module.css";

type Props = {
  artistId: string;
  artistName: string;
  callbackUrl: string;
  state: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function callbackWith(callbackUrl: string, state: string, values: Record<string, string>) {
  const callback = new URL(callbackUrl);
  callback.searchParams.set("state", state);
  for (const [key, value] of Object.entries(values)) callback.searchParams.set(key, value);
  return callback.toString();
}

export function LibraryBridgeConnect({ artistId, artistName, callbackUrl, state }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/studio/dj-library/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_pairing", artistId }),
      });
      const body = await response.json().catch(() => null);
      const code = String(record(body).code ?? "").trim();
      if (!response.ok || !code) {
        throw new Error(String(record(body).error ?? "Ensemblis could not authorize this computer."));
      }
      window.location.assign(callbackWith(callbackUrl, state, { code }));
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : "Ensemblis could not authorize this computer.");
    }
  }

  function cancel() {
    window.location.assign(callbackWith(callbackUrl, state, { error: "cancelled" }));
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="bridge-connect-title">
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden><EnsemblisMark /></span>
          <strong>Ensemblis</strong>
        </div>
        <div className={styles.visual} aria-hidden="true">
          <span className={styles.computer}><i /></span>
          <span className={styles.link}><i /><i /><i /></span>
          <span className={styles.ensemblis}><EnsemblisMark /></span>
        </div>
        <div className={styles.copy}>
          <span className={styles.kicker}>Connect this computer</span>
          <h1 id="bridge-connect-title">Allow local music access?</h1>
          <p>
            Connect this computer to <strong>{artistName}</strong> so Ensemblis can work with its music library locally.
            Your original audio files and folder locations stay on this computer.
          </p>
        </div>
        <div className={styles.permissions}>
          <div><span>✓</span><p><strong>Analyze music locally</strong><small>Compatible processing happens on this computer.</small></p></div>
          <div><span>✓</span><p><strong>Keep file locations private</strong><small>Local paths never become part of your cloud project data.</small></p></div>
          <div><span>✓</span><p><strong>Disconnect anytime</strong><small>Revoke this computer from Ensemblis settings whenever you want.</small></p></div>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect computer"}
          </button>
          <button type="button" className={styles.secondary} onClick={cancel} disabled={busy}>Cancel</button>
        </div>
        <small className={styles.footer}>One-time secure authorization · expires automatically</small>
      </section>
    </main>
  );
}
