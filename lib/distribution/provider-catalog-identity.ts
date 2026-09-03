import type { DistributionAccount } from "@/types/distribution-database";
import { accessTokenForDistributionAccount, revelatorV1Base } from "./provider-account";

export type ProviderTrackIdentity = {
  providerTrackId: string;
  name: string;
  isrc: string | null;
  audioId: string | null;
  audioFilename: string | null;
  fileFormat: number | null;
};

export type ProviderCatalogIdentity = {
  providerReleaseId: string;
  upc: string | null;
  isLockedForDistribution: boolean | null;
  tracks: ProviderTrackIdentity[];
  raw: unknown;
};

function responseMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "title" in body) return String((body as { title?: unknown }).title);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  if (body && typeof body === "object" && "error" in body) return String((body as { error?: unknown }).error);
  return `Distribution catalog request failed (${status}).`;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

export async function getProviderCatalogIdentity(account: DistributionAccount, providerReleaseId: string): Promise<ProviderCatalogIdentity> {
  if (account.provider !== "revelator") throw new Error(`Unsupported distribution catalog provider: ${account.provider}`);
  const token = await accessTokenForDistributionAccount(account);
  const response = await fetch(`${revelatorV1Base()}/content/release/${encodeURIComponent(providerReleaseId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await response.text();
  let raw: unknown = null;
  if (text) {
    try { raw = JSON.parse(text); } catch { raw = text; }
  }
  if (!response.ok) throw new Error(responseMessage(raw, response.status));
  const release = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const tracks = records(release.tracks).map((track) => {
    const versions = records(track.trackRecordingVersions);
    const stereo = versions.find((version) => Number(version.recordingVersionType) === 1) ?? versions[0] ?? {};
    const audioFiles = records(stereo.audioFiles);
    const audio = audioFiles[0] ?? {};
    const providerTrackId = String(track.trackId ?? "").trim();
    if (!providerTrackId || providerTrackId === "0") throw new Error("Provider release contains a track without a usable track ID.");
    return {
      providerTrackId,
      name: String(track.name ?? "").trim(),
      isrc: String(stereo.isrc ?? track.isrc ?? "").trim() || null,
      audioId: String(audio.audioId ?? "").trim() || null,
      audioFilename: String(audio.audioFilename ?? "").trim() || null,
      fileFormat: Number.isFinite(Number(audio.fileFormat)) ? Number(audio.fileFormat) : null,
    };
  });
  const resolvedReleaseId = String(release.releaseId ?? providerReleaseId).trim();
  if (!resolvedReleaseId || resolvedReleaseId === "0") throw new Error("Provider release lookup returned no usable release ID.");
  return {
    providerReleaseId: resolvedReleaseId,
    upc: String(release.upc ?? "").trim() || null,
    isLockedForDistribution: typeof release.isLockedForDistribution === "boolean" ? release.isLockedForDistribution : null,
    tracks,
    raw,
  };
}
