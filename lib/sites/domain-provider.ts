import "server-only";

import { domainToASCII } from "node:url";

export type SiteDnsInstruction = {
  type: "A" | "AAAA" | "CNAME" | "TXT";
  name: string;
  value: string;
  reason: "routing" | "ownership" | "verification";
};

export type SiteDomainProviderState = {
  hostname: string;
  provider: string;
  providerRef: string | null;
  verified: boolean;
  sslActive: boolean;
  dns: SiteDnsInstruction[];
  message: string | null;
};

export interface SiteDomainProvider {
  readonly key: string;
  attach(hostname: string): Promise<SiteDomainProviderState>;
  inspect(hostname: string): Promise<SiteDomainProviderState>;
  verify(hostname: string): Promise<SiteDomainProviderState>;
  detach(hostname: string): Promise<void>;
}

export function normalizeSiteHostname(input: string) {
  const raw = input.trim().toLowerCase();
  if (!raw) throw new Error("Domain is required.");

  let hostname = raw;
  if (raw.includes("://")) {
    hostname = new URL(raw).hostname;
  } else {
    hostname = raw.split("/")[0].split(":")[0];
  }

  hostname = domainToASCII(hostname.replace(/^\.+|\.+$/g, "")).toLowerCase();
  if (!hostname || hostname.length > 253) throw new Error("Domain is invalid.");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost cannot be connected as a public artist domain.");
  }
  if (hostname.startsWith("*.")) {
    throw new Error("Wildcard custom domains are not supported in the first Sites release.");
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error("Domain is invalid.");
  }
  return hostname;
}
