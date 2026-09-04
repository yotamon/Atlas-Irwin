import "server-only";

import type { SiteDomainProvider } from "@/lib/sites/domain-provider";
import { VercelSiteDomainProvider } from "@/lib/sites/providers/vercel-domain-provider";

const providers = new Map<string, () => SiteDomainProvider>([
  ["vercel", () => new VercelSiteDomainProvider()],
]);

export function getSiteDomainProvider(key = "vercel"): SiteDomainProvider {
  const factory = providers.get(key);
  if (!factory) throw new Error(`Unknown site domain provider: ${key}`);
  return factory();
}
