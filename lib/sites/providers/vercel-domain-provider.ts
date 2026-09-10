import "server-only";

import {
  normalizeSiteHostname,
  type SiteDnsInstruction,
  type SiteDomainProvider,
  type SiteDomainProviderState,
} from "@/lib/sites/domain-provider";

type VercelVerification = {
  type?: string;
  domain?: string;
  value?: string;
  reason?: string;
};

type VercelProjectDomain = {
  name?: string;
  projectId?: string;
  verified?: boolean;
  verification?: VercelVerification[];
};

type VercelDomainConfig = {
  misconfigured?: boolean;
  configuredBy?: string | null;
  recommendedIPv4?: Array<{ rank?: number; value?: string }>;
  recommendedCNAME?: Array<{ rank?: number; value?: string }>;
};

type VercelErrorPayload = {
  error?: { code?: string; message?: string };
};

function providerConfig() {
  const token = process.env.VERCEL_TOKEN?.trim();
  const project = (process.env.ENSEMBLIS_SITES_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID)?.trim();
  const teamId = (process.env.ENSEMBLIS_SITES_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID)?.trim();
  if (!token || !project) {
    throw new Error("VERCEL_TOKEN and ENSEMBLIS_SITES_VERCEL_PROJECT_ID are required for custom-domain operations.");
  }
  return { token, project, teamId };
}

function teamQuery(teamId?: string) {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = providerConfig();
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({})) as T & VercelErrorPayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Vercel domain request failed with HTTP ${response.status}.`);
  }
  return payload;
}

function verificationDns(domain: VercelProjectDomain): SiteDnsInstruction[] {
  return (domain.verification ?? []).flatMap((item) => {
    const type = item.type?.toUpperCase();
    if (!item.domain || !item.value || !["A", "AAAA", "CNAME", "TXT"].includes(type || "")) return [];
    return [{
      type: type as SiteDnsInstruction["type"],
      name: item.domain,
      value: item.value,
      reason: "ownership" as const,
    }];
  });
}

function routingDns(hostname: string, config: VercelDomainConfig): SiteDnsInstruction[] {
  const cname = config.recommendedCNAME
    ?.filter((entry) => entry.value)
    .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99))[0]?.value;
  const ipv4 = config.recommendedIPv4
    ?.filter((entry) => entry.value)
    .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99))[0]?.value;
  const isApex = hostname.split(".").length === 2;

  if (!isApex && cname) {
    return [{ type: "CNAME", name: hostname, value: cname, reason: "routing" }];
  }
  if (isApex && ipv4) {
    return [{ type: "A", name: hostname, value: ipv4, reason: "routing" }];
  }
  return [];
}

export class VercelSiteDomainProvider implements SiteDomainProvider {
  readonly key = "vercel";

  async attach(input: string): Promise<SiteDomainProviderState> {
    const hostname = normalizeSiteHostname(input);
    const { project, teamId } = providerConfig();
    await vercelRequest<VercelProjectDomain>(
      `/v9/projects/${encodeURIComponent(project)}/domains${teamQuery(teamId)}`,
      { method: "POST", body: JSON.stringify({ name: hostname }) },
    );
    return this.inspect(hostname);
  }

  async inspect(input: string): Promise<SiteDomainProviderState> {
    const hostname = normalizeSiteHostname(input);
    const { project, teamId } = providerConfig();
    const [domain, config] = await Promise.all([
      vercelRequest<VercelProjectDomain>(
        `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}${teamQuery(teamId)}`,
      ),
      vercelRequest<VercelDomainConfig>(
        `/v6/domains/${encodeURIComponent(hostname)}/config${teamQuery(teamId)}`,
      ),
    ]);

    const dns = [...verificationDns(domain), ...routingDns(hostname, config)];
    const configured = config.misconfigured === false;
    const verified = domain.verified === true;
    return {
      hostname,
      provider: this.key,
      providerRef: domain.projectId || null,
      verified,
      sslActive: verified && configured,
      dns,
      message: verified && configured
        ? "Domain is verified and routing is configured."
        : dns.length
          ? "Apply the required DNS records, then verify again."
          : "Domain is attached but Vercel still reports incomplete configuration.",
    };
  }

  async verify(input: string): Promise<SiteDomainProviderState> {
    const hostname = normalizeSiteHostname(input);
    const { project, teamId } = providerConfig();
    await vercelRequest<VercelProjectDomain>(
      `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}/verify${teamQuery(teamId)}`,
      { method: "POST" },
    );
    return this.inspect(hostname);
  }

  async detach(input: string): Promise<void> {
    const hostname = normalizeSiteHostname(input);
    const { project, teamId } = providerConfig();
    await vercelRequest<Record<string, unknown>>(
      `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}${teamQuery(teamId)}`,
      { method: "DELETE" },
    );
  }
}
