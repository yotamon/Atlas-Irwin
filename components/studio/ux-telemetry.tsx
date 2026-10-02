"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  STUDIO_UX_EVENT,
  type StudioUxEventDetail,
} from "@/lib/studio/ux-telemetry-client";

function surfaceFor(pathname: string) {
  if (pathname === "/studio") return "today";
  if (pathname.startsWith("/studio/music/automix")) return "mix";
  if (/^\/studio\/music\/[^/]+/.test(pathname)) return "track";
  if (/^\/studio\/releases\/[^/]+/.test(pathname)) return "release";
  if (pathname.startsWith("/studio/music") || pathname.startsWith("/studio/releases")) return "music";
  if (pathname.startsWith("/studio/create") || pathname.startsWith("/studio/video") || pathname.startsWith("/studio/production")) return "create";
  if (pathname.startsWith("/studio/growth") || pathname.startsWith("/studio/audience") || pathname.startsWith("/studio/analytics") || pathname.startsWith("/studio/campaigns")) return "grow";
  if (pathname.startsWith("/studio/settings") || pathname.startsWith("/studio/connections")) return "settings";
  if (pathname.startsWith("/studio/library") || pathname.startsWith("/studio/media")) return "library";
  if (pathname.startsWith("/studio/sites")) return "sites";
  if (pathname.startsWith("/studio/needs-you") || pathname.startsWith("/studio/inbox")) return "needs_you";
  return "specialist";
}

function sessionId() {
  const key = "ensemblis_ux_session";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function post(payload: Record<string, unknown>) {
  const data = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/studio/ux-event", new Blob([data], { type: "application/json" }));
    return;
  }
  void fetch("/api/studio/ux-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data,
    keepalive: true,
  });
}

export function StudioUxTelemetry({ artistId }: { artistId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const enteredAtRef = useRef<number | null>(null);
  const previousSurfaceRef = useRef<string | null>(null);

  useEffect(() => {
    const now = performance.now();
    const nextSurface = surfaceFor(pathname);
    const durationMs = previousSurfaceRef.current && enteredAtRef.current !== null
      ? Math.max(0, Math.round(now - enteredAtRef.current))
      : null;
    post({
      artistId,
      sessionId: sessionId(),
      event: "surface_view",
      surface: nextSurface,
      source: previousSurfaceRef.current ? "navigation" : "entry",
      previousSurface: previousSurfaceRef.current,
      durationMs,
      hasQueryState: searchParams.size > 0,
    });
    previousSurfaceRef.current = nextSurface;
    enteredAtRef.current = now;
  }, [artistId, pathname, searchParams]);

  useEffect(() => {
    function onUxEvent(event: Event) {
      const detail = (event as CustomEvent<StudioUxEventDetail>).detail;
      if (!detail?.event) return;
      post({
        artistId,
        sessionId: sessionId(),
        event: detail.event,
        surface: surfaceFor(window.location.pathname),
        source: detail.source ?? null,
        intentKind: detail.intentKind ?? null,
        resultType: detail.resultType ?? null,
        resolutionSource: detail.resolutionSource ?? null,
        durationMs: detail.durationMs ?? null,
      });
    }

    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const advanced = target.closest("details > summary");
      if (advanced) {
        const details = advanced.parentElement;
        if (
          details?.classList.contains("v2-advanced-disclosure")
          || details?.classList.contains("track-object-advanced")
          || details?.classList.contains("track-v5-workspace")
          || details?.classList.contains("release-v5-secondary")
        ) {
          window.setTimeout(() => {
            if (details instanceof HTMLDetailsElement && details.open) {
              post({
                artistId,
                sessionId: sessionId(),
                event: "advanced_opened",
                surface: surfaceFor(window.location.pathname),
                source: Array.from(details.classList).sort().join(".").slice(0, 120),
              });
            }
          }, 0);
        }
      }

      const primary = target.closest("a.button.primary, button.button.primary, .en-object-action-bar a");
      if (primary && !target.closest("[data-command-result]")) {
        post({
          artistId,
          sessionId: sessionId(),
          event: "primary_action",
          surface: surfaceFor(window.location.pathname),
          source: primary.closest(".en-object-action-bar") ? "object_action_bar" : "surface",
          durationMs: enteredAtRef.current === null ? null : Math.max(0, Math.round(performance.now() - enteredAtRef.current)),
        });
      }
    }

    window.addEventListener(STUDIO_UX_EVENT, onUxEvent);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener(STUDIO_UX_EVENT, onUxEvent);
      document.removeEventListener("click", onClick);
    };
  }, [artistId]);

  return null;
}
