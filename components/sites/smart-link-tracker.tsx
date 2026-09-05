"use client";

import { useEffect } from "react";

export function SmartLinkTracker({ siteId, slug }: { siteId: string; slug: string }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = {
      siteId,
      slug,
      sourceCode: params.get("src"),
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      utmContent: params.get("utm_content"),
    };
    void fetch("/api/smart-links/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  }, [siteId, slug]);

  return null;
}
