import type { DistributionIssue } from "./domain";

export type ProviderValidationResult = {
  ready: boolean;
  issues: DistributionIssue[];
  raw: unknown;
};

export type ProviderDelivery = {
  storeId: string;
  storeName: string;
  providerStatus: string | number | null;
  url?: string | null;
  raw?: unknown;
};

export interface DistributionProvider {
  readonly id: string;
  validateRelease(providerReleaseId: string, storeIds?: number[]): Promise<ProviderValidationResult>;
  submitRelease(providerReleaseId: string, storeIds: number[]): Promise<void>;
  getDistributionStatus(providerReleaseId: string): Promise<ProviderDelivery[]>;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function issueFromRevelator(input: Record<string, unknown>, storeId?: number): DistributionIssue {
  const rawSeverity = String(input.severity ?? "").toLowerCase();
  const severity = rawSeverity === "1" || rawSeverity === "error" ? "error" : rawSeverity === "2" || rawSeverity === "warning" ? "warning" : "info";
  const objectType = String(input.objectType ?? "release").toLowerCase();
  return {
    code: `revelator.${String(input.category ?? "metadata")}.${String(input.objectId ?? "release")}`,
    title: severity === "error" ? "Distribution requirement needs attention" : "Review distribution warning",
    detail: stripHtml(String(input.errorMessage ?? input.message ?? "Revelator reported a distribution validation issue.")),
    severity,
    source: storeId ? "store" : "provider",
    objectType: ["release", "track", "artist"].includes(objectType) ? objectType as "release" | "track" | "artist" : "release",
    objectId: input.objectId == null ? undefined : String(input.objectId),
    storeId: storeId == null ? undefined : String(storeId),
  };
}

export class RevelatorProvider implements DistributionProvider {
  readonly id = "revelator";
  private readonly token: string;
  private readonly v1Base: string;
  private readonly v2Base: string;

  constructor(options?: { token?: string; v1Base?: string; v2Base?: string }) {
    this.token = options?.token ?? process.env.REVELATOR_ACCESS_TOKEN?.trim() ?? "";
    this.v1Base = (options?.v1Base ?? process.env.REVELATOR_API_V1_BASE_URL ?? "https://api.revelator.com").replace(/\/$/, "");
    this.v2Base = (options?.v2Base ?? process.env.REVELATOR_API_V2_BASE_URL ?? "https://platform.revelator.com").replace(/\/$/, "");
    if (!this.token) throw new Error("REVELATOR_ACCESS_TOKEN is required to use the Revelator distribution provider.");
  }

  private async request(base: string, path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const message = body && typeof body === "object" && "title" in body
        ? String((body as { title?: unknown }).title)
        : `Revelator request failed (${response.status}).`;
      const error = new Error(message) as Error & { status?: number; body?: unknown };
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async validateRelease(providerReleaseId: string, storeIds: number[] = []): Promise<ProviderValidationResult> {
    const query = storeIds.length ? `?${storeIds.map((id) => `distributorStoreIds=${encodeURIComponent(id)}`).join("&")}` : "";
    const raw = await this.request(this.v2Base, `/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/deliver/validate${query}`);
    const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const issues: DistributionIssue[] = [];
    const metadataErrors = Array.isArray(body.metadataErrors) ? body.metadataErrors : [];
    for (const issue of metadataErrors) if (issue && typeof issue === "object") issues.push(issueFromRevelator(issue as Record<string, unknown>));
    const perStore = Array.isArray(body.perDistributorStoreErrors) ? body.perDistributorStoreErrors : [];
    for (const bucket of perStore) {
      if (!bucket || typeof bucket !== "object") continue;
      const typed = bucket as Record<string, unknown>;
      const storeId = Number(typed.distributorStoreId);
      const errors = Array.isArray(typed.errors) ? typed.errors : [];
      for (const issue of errors) if (issue && typeof issue === "object") issues.push(issueFromRevelator(issue as Record<string, unknown>, Number.isFinite(storeId) ? storeId : undefined));
    }
    return { ready: body.hasBlockingErrors !== true && !issues.some((issue) => issue.severity === "error"), issues, raw };
  }

  async submitRelease(providerReleaseId: string, storeIds: number[]) {
    if (!storeIds.length) throw new Error("At least one Revelator store must be selected before distribution.");
    await this.request(this.v1Base, `/distribution/release/addtoqueue?releaseId=${encodeURIComponent(providerReleaseId)}`, {
      method: "POST",
      body: JSON.stringify(storeIds),
    });
  }

  async getDistributionStatus(providerReleaseId: string): Promise<ProviderDelivery[]> {
    const raw = await this.request(this.v1Base, `/distribution/release/all?pageNumber=1&pageSize=100&searchTerm=${encodeURIComponent(providerReleaseId)}`);
    const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const items = Array.isArray(body.items) ? body.items : Array.isArray(raw) ? raw : [];
    const release = (items as unknown[]).find((item) => item && typeof item === "object" && String((item as Record<string, unknown>).releaseId ?? (item as Record<string, unknown>).id ?? "") === providerReleaseId);
    if (!release || typeof release !== "object") return [];
    const distributions = (release as Record<string, unknown>).distributionStatuses ?? (release as Record<string, unknown>).stores ?? [];
    if (!Array.isArray(distributions)) return [];
    return distributions.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({
      storeId: String(item.distributorStoreId ?? item.storeId ?? item.id ?? "unknown"),
      storeName: String(item.distributorStoreName ?? item.storeName ?? item.name ?? "DSP"),
      providerStatus: (item.status ?? item.distributionStatus ?? null) as string | number | null,
      url: item.url == null ? null : String(item.url),
      raw: item,
    }));
  }
}

export function getDistributionProvider(): DistributionProvider {
  const provider = (process.env.DISTRIBUTION_PROVIDER ?? "revelator").trim().toLowerCase();
  if (provider === "revelator") return new RevelatorProvider();
  throw new Error(`Unsupported distribution provider: ${provider}`);
}
