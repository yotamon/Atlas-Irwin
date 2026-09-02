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

export type ProviderStore = {
  id: number;
  name: string;
  active: boolean;
  category?: string | null;
  raw?: unknown;
};

export interface DistributionProvider {
  readonly id: string;
  listStores(): Promise<ProviderStore[]>;
  validateRelease(providerReleaseId: string, storeIds?: number[]): Promise<ProviderValidationResult>;
  submitRelease(providerReleaseId: string, storeIds: number[]): Promise<void>;
  getDistributionStatus(providerReleaseId: string): Promise<ProviderDelivery[]>;
}

type CachedProviderToken = {
  cacheKey: string;
  token: string;
  expiresAt: number;
};

let cachedProviderToken: CachedProviderToken | null = null;

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
    detail: stripHtml(String(input.errorMessage ?? input.message ?? "The distribution provider reported a validation issue.")),
    severity,
    source: storeId ? "store" : "provider",
    objectType: ["release", "track", "artist"].includes(objectType) ? objectType as "release" | "track" | "artist" : "release",
    objectId: input.objectId == null ? undefined : String(input.objectId),
    storeId: storeId == null ? undefined : String(storeId),
  };
}

function recordArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!raw || typeof raw !== "object") return [];
  const body = raw as Record<string, unknown>;
  for (const key of ["items", "data", "stores", "results"]) {
    if (Array.isArray(body[key])) return (body[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  return [];
}

function responseMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "title" in body) return String((body as { title?: unknown }).title);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  return `Distribution provider request failed (${status}).`;
}

export class RevelatorProvider implements DistributionProvider {
  readonly id = "revelator";
  private readonly staticToken: string;
  private readonly partnerApiKey: string;
  private readonly partnerUserId: string;
  private readonly v1Base: string;
  private readonly v2Base: string;

  constructor(options?: {
    token?: string;
    partnerApiKey?: string;
    partnerUserId?: string;
    v1Base?: string;
    v2Base?: string;
  }) {
    this.staticToken = options?.token ?? process.env.REVELATOR_ACCESS_TOKEN?.trim() ?? "";
    this.partnerApiKey = options?.partnerApiKey ?? process.env.REVELATOR_PARTNER_API_KEY?.trim() ?? "";
    this.partnerUserId = options?.partnerUserId ?? process.env.REVELATOR_PARTNER_USER_ID?.trim() ?? "";
    this.v1Base = (options?.v1Base ?? process.env.REVELATOR_API_V1_BASE_URL ?? "https://api.revelator.com").replace(/\/$/, "");
    this.v2Base = (options?.v2Base ?? process.env.REVELATOR_API_V2_BASE_URL ?? "https://platform.revelator.com").replace(/\/$/, "");
    if (!this.staticToken && !(this.partnerApiKey && this.partnerUserId)) {
      throw new Error("Distribution provider credentials are not configured.");
    }
  }

  private tokenCacheKey() {
    return `${this.v1Base}|${this.partnerUserId}`;
  }

  private async getAccessToken(forceRefresh = false) {
    if (this.staticToken) return this.staticToken;
    const cacheKey = this.tokenCacheKey();
    if (!forceRefresh && cachedProviderToken?.cacheKey === cacheKey && cachedProviderToken.expiresAt > Date.now() + 60_000) {
      return cachedProviderToken.token;
    }

    const response = await fetch(`${this.v1Base}/partner/account/login`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ partnerApiKey: this.partnerApiKey, partnerUserId: this.partnerUserId }),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) throw new Error(responseMessage(body, response.status));
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const token = String(record.accessToken ?? record.token ?? "").trim();
    if (!token) throw new Error("Distribution provider authentication returned no access token.");

    // Revelator currently documents an 8-hour access token. Refresh conservatively before expiry.
    cachedProviderToken = { cacheKey, token, expiresAt: Date.now() + 7.5 * 60 * 60 * 1000 };
    return token;
  }

  private async request(base: string, path: string, init: RequestInit = {}, retried = false): Promise<unknown> {
    const token = await this.getAccessToken(retried);
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (response.status === 401 && !this.staticToken && !retried) {
      cachedProviderToken = null;
      return this.request(base, path, init, true);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const error = new Error(responseMessage(body, response.status)) as Error & { status?: number; body?: unknown };
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async listStores(): Promise<ProviderStore[]> {
    const raw = await this.request(this.v1Base, "/common/lookup/stores");
    const stores: ProviderStore[] = [];
    for (const item of recordArray(raw)) {
      const id = Number(item.distributorStoreId ?? item.storeId ?? item.id);
      if (!Number.isFinite(id)) continue;
      stores.push({
        id,
        name: String(item.distributorStoreName ?? item.storeName ?? item.name ?? `Store ${id}`),
        active: item.isActive !== false && item.active !== false && String(item.status ?? "").toLowerCase() !== "disabled",
        category: item.category == null ? null : String(item.category),
        raw: item,
      });
    }
    return stores.sort((a, b) => a.name.localeCompare(b.name));
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
    if (!storeIds.length) throw new Error("At least one music service must be selected before distribution.");
    await this.request(this.v1Base, `/distribution/release/addtoqueue?releaseId=${encodeURIComponent(providerReleaseId)}`, {
      method: "POST",
      body: JSON.stringify(storeIds),
    });
  }

  async getDistributionStatus(providerReleaseId: string): Promise<ProviderDelivery[]> {
    const raw = await this.request(this.v1Base, `/distribution/release/all?pageNumber=1&pageSize=100&searchTerm=${encodeURIComponent(providerReleaseId)}`);
    const items = recordArray(raw);
    const release = items.find((item) => String(item.releaseId ?? item.id ?? "") === providerReleaseId);
    if (!release) return [];
    const distributions = release.distributionStatuses ?? release.stores ?? [];
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

export function distributionProviderConfigured() {
  const staticToken = process.env.REVELATOR_ACCESS_TOKEN?.trim();
  const partnerApiKey = process.env.REVELATOR_PARTNER_API_KEY?.trim();
  const partnerUserId = process.env.REVELATOR_PARTNER_USER_ID?.trim();
  return Boolean(staticToken || (partnerApiKey && partnerUserId));
}

export function getDistributionProvider(): DistributionProvider {
  const provider = (process.env.DISTRIBUTION_PROVIDER ?? "revelator").trim().toLowerCase();
  if (provider === "revelator") return new RevelatorProvider();
  throw new Error(`Unsupported distribution provider: ${provider}`);
}
