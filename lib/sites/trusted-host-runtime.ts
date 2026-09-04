import "server-only";

import { loadPublishedSiteByHostname } from "@/lib/sites/runtime";

export async function loadTrustedHostRuntime(
  siteId: string,
  requestHeaders: Headers,
) {
  const trustedSiteId = requestHeaders.get("x-ensemblis-site-id");
  const trustedHostname = requestHeaders.get("x-ensemblis-site-host");
  if (!trustedHostname || trustedSiteId !== siteId) return null;

  const runtime = await loadPublishedSiteByHostname(trustedHostname);
  if (!runtime || runtime.site.id !== siteId) return null;
  return { runtime, hostname: trustedHostname };
}
