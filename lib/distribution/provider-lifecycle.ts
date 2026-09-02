import type { DistributionAccount } from "@/types/distribution-database";
import type { DistributionIssue } from "./domain";
import {
  accessTokenForDistributionAccount,
  revelatorV1Base,
  revelatorV2Base,
} from "./provider-account";

export type ProviderTakedownValidation = {
  ready: boolean;
  issues: DistributionIssue[];
  raw: unknown;
};

export interface DistributionLifecycleProvider {
  validateTakedown(providerReleaseId: string, storeIds: number[]): Promise<ProviderTakedownValidation>;
  takedownRelease(providerReleaseId: string, storeIds: number[]): Promise<unknown>;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function responseMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "title" in body) return String((body as { title?: unknown }).title);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  if (body && typeof body === "object" && "error" in body) return String((body as { error?: unknown }).error);
  return `Distribution lifecycle request failed (${status}).`;
}

function issue(input: Record<string, unknown>, storeId?: number): DistributionIssue {
  const severity = String(input.severity ?? "").toLowerCase() === "warning" ? "warning" : "error";
  const objectType = String(input.objectType ?? "release").toLowerCase();
  return {
    code: `revelator.takedown.${String(input.category ?? "metadata")}.${String(input.objectId ?? "release")}`,
    title: severity === "error" ? "Takedown requirement needs attention" : "Review takedown warning",
    detail: stripHtml(String(input.errorMessage ?? input.message ?? "The provider reported a takedown validation issue.")),
    severity,
    source: storeId == null ? "provider" : "store",
    objectType: ["release", "track", "artist"].includes(objectType) ? objectType as "release" | "track" | "artist" : "release",
    objectId: input.objectId == null ? undefined : String(input.objectId),
    storeId: storeId == null ? undefined : String(storeId),
  };
}

export class RevelatorLifecycleProvider implements DistributionLifecycleProvider {
  constructor(private readonly account: DistributionAccount) {}

  private async request(base: string, path: string, init: RequestInit = {}) {
    const token = await accessTokenForDistributionAccount(this.account);
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

  async validateTakedown(providerReleaseId: string, storeIds: number[]): Promise<ProviderTakedownValidation> {
    if (!storeIds.length) throw new Error("Choose at least one delivered music service before requesting a takedown.");
    const query = storeIds.map((id) => `distributorStoreIds=${encodeURIComponent(id)}`).join("&");
    const raw = await this.request(revelatorV2Base(), `/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/takedown/validate?${query}`);
    const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const issues: DistributionIssue[] = [];
    const metadataErrors = Array.isArray(body.metadataErrors) ? body.metadataErrors : [];
    for (const item of metadataErrors) if (item && typeof item === "object") issues.push(issue(item as Record<string, unknown>));
    const perStore = Array.isArray(body.perDistributorStoreErrors) ? body.perDistributorStoreErrors : [];
    for (const bucket of perStore) {
      if (!bucket || typeof bucket !== "object") continue;
      const record = bucket as Record<string, unknown>;
      const storeId = Number(record.distributorStoreId);
      const errors = Array.isArray(record.errors) ? record.errors : [];
      for (const item of errors) if (item && typeof item === "object") issues.push(issue(item as Record<string, unknown>, Number.isFinite(storeId) ? storeId : undefined));
    }
    return {
      ready: body.hasBlockingErrors !== true && !issues.some((item) => item.severity === "error"),
      issues,
      raw,
    };
  }

  async takedownRelease(providerReleaseId: string, storeIds: number[]) {
    if (!storeIds.length) throw new Error("Choose at least one delivered music service before requesting a takedown.");
    return this.request(revelatorV1Base(), `/distribution/release/takedown?releaseId=${encodeURIComponent(providerReleaseId)}`, {
      method: "POST",
      body: JSON.stringify(storeIds),
    });
  }
}

export function lifecycleProviderForDistributionAccount(account: DistributionAccount | null | undefined): DistributionLifecycleProvider {
  if (!account) throw new Error("Distribution account is not configured.");
  if (account.provider !== "revelator") throw new Error(`Unsupported distribution lifecycle provider: ${account.provider}`);
  return new RevelatorLifecycleProvider(account);
}
