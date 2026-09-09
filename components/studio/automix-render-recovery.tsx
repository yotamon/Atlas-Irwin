"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiRefreshCw } from "react-icons/fi";
import type { AutoMixJob } from "@/types/automix-database";
import styles from "./automix-render-recovery.module.css";

type JobView = AutoMixJob & {
  output?: { public_url?: string | null } | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function executionMode(job: JobView) {
  const mode = record(job.request_payload).execution_mode;
  return typeof mode === "string" ? mode : "render";
}

function responseError(value: unknown, fallback: string) {
  const body = record(value);
  return typeof body.error === "string" ? body.error : fallback;
}

export function AutoMixRenderRecovery({ artistId }: { artistId: string }) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseError(body, "Could not inspect approved renders."));
    const raw = record(body).jobs;
    setJobs(Array.isArray(raw) ? raw as JobView[] : []);
  }, [artistId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        if (cancelled || !response.ok) return;
        const raw = record(body).jobs;
        setJobs(Array.isArray(raw) ? raw as JobView[] : []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [artistId]);

  const latestApprovedRender = useMemo(
    () => jobs.find((job) => executionMode(job) === "approved_render") ?? null,
    [jobs],
  );
  const failedRender = latestApprovedRender?.status === "failed" ? latestApprovedRender : null;
  const hasActiveRender = latestApprovedRender
    ? ["planned", "queued", "running"].includes(latestApprovedRender.status)
    : false;

  if (!failedRender) return null;

  async function retry() {
    if (retrying || hasActiveRender) return;
    setRetrying(true);
    setMessage("");
    try {
      const response = await fetch("/api/studio/automix/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistId,
          action: "retry_render",
          parentJobId: failedRender.id,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Could not retry the approved render."));
      setMessage("Exact MixPlan retry queued. No replanning was performed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not retry the approved render.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className={styles.recovery} aria-label="Approved render recovery">
      <div className={styles.icon}><FiAlertTriangle aria-hidden /></div>
      <div className={styles.copy}>
        <span className="section-label">Render recovery</span>
        <strong>The frozen MixPlan is available for a safe retry.</strong>
        <p>
          Ensemblis will revalidate the canonical source lineage first. If it still matches, the renderer retries this exact plan hash
          without choosing a new order or changing a transition. If a master changed, a new verified plan is required instead.
        </p>
        {failedRender.error ? <small>{failedRender.error}</small> : null}
        {message ? <small role="status">{message}</small> : null}
      </div>
      <button className="button button-primary" type="button" disabled={retrying || hasActiveRender} onClick={() => void retry()}>
        <FiRefreshCw aria-hidden /> {retrying ? "Retrying…" : "Retry exact render"}
      </button>
    </section>
  );
}
