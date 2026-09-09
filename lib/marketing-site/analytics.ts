type MarketingEvent =
  | "homepage_viewed"
  | "analyze_clicked"
  | "demo_started"
  | "demo_tab_viewed"
  | "pillar_viewed"
  | "audio_error";
type EventProperties = {
  section?: string;
  pillar?: string;
  demo_track_id?: string;
};

/** Provider-neutral, opt-in integration point. No cookies, audio or user data are collected. */
export function trackMarketingEvent(
  event: MarketingEvent,
  properties: EventProperties = {},
) {
  if (typeof window === "undefined" || navigator.doNotTrack === "1") return;
  window.dispatchEvent(
    new CustomEvent("ensemblis:marketing", {
      detail: {
        event,
        properties: { ...properties, source_page: window.location.pathname },
      },
    }),
  );
}
