import type { DistributionAccount } from "@/types/distribution-database";
import type { ProviderDelivery } from "./provider";
import { accessTokenForDistributionAccount, revelatorV1Base } from "./provider-account";

function responseMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "title" in body) return String((body as { title?: unknown }).title);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  return `Distribution status request failed (${status}).`;
}

function records(raw: unknown) {
  if (!raw || typeof raw !== "object") return [] as Record<string, unknown>[];
  const body = raw as Record<string, unknown>;
  return Array.isArray(body.items)
    ? body.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

export async function getDistributionStatusForAccount(
  account: DistributionAccount,
  providerReleaseId: string,
): Promise<ProviderDelivery[]> {
  const token = await accessTokenForDistributionAccount(account);
  const response = await fetch(`${revelatorV1Base()}/distribution/store/all?releaseId=${encodeURIComponent(providerReleaseId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) throw new Error(responseMessage(body, response.status));

  return records(body).map((item) => {
    const releaseStatus = item.releaseStatus && typeof item.releaseStatus === "object"
      ? item.releaseStatus as Record<string, unknown>
      : {};
    const numericStatus = releaseStatus.status;
    const statusText = releaseStatus.statusText;
    return {
      storeId: String(item.distributorStoreId ?? "unknown"),
      storeName: String(item.distributorStoreName ?? item.storeName ?? `Store ${String(item.distributorStoreId ?? "")}`),
      providerStatus: numericStatus == null ? (statusText == null ? null : String(statusText)) : Number(numericStatus),
      url: releaseStatus.urlInStore == null ? null : String(releaseStatus.urlInStore),
      raw: item,
    };
  });
}
