import type { DistributionAccount } from "@/types/distribution-database";
import type {
  ProviderCatalogContributor,
  ProviderCatalogRelease,
  ProviderCatalogWriter,
} from "./provider";
import { accessTokenForDistributionAccount, revelatorV1Base } from "./provider-account";

type LookupKind = "store" | "language" | "musicStyle" | "contributorRole" | "trackProperty";
type LookupItem = { id: number; name: string; groupId?: number | null; raw: Record<string, unknown> };

type ExistingProviderTrack = Record<string, unknown> & {
  trackId?: unknown;
  trackRecordingVersions?: unknown;
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function recordArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return records(raw);
  if (!raw || typeof raw !== "object") return [];
  const body = raw as Record<string, unknown>;
  for (const key of ["items", "data", "stores", "results"]) if (Array.isArray(body[key])) return records(body[key]);
  return [];
}

function responseMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "title" in body) return String((body as { title?: unknown }).title);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  if (body && typeof body === "object" && "error" in body) return String((body as { error?: unknown }).error);
  return `Distribution catalog update failed (${status}).`;
}

function lookupItem(item: Record<string, unknown>, kind: LookupKind): LookupItem | null {
  const ids: Record<LookupKind, unknown[]> = {
    store: [item.distributorStoreId, item.storeId, item.id],
    language: [item.languageId, item.id],
    musicStyle: [item.musicStyleId, item.styleId, item.id],
    contributorRole: [item.roleId, item.contributorRoleId, item.id],
    trackProperty: [item.trackPropertyId, item.propertyId, item.id],
  };
  const names: Record<LookupKind, unknown[]> = {
    store: [item.distributorStoreName, item.storeName, item.name],
    language: [item.languageCode, item.isoCode, item.code, item.name, item.languageName],
    musicStyle: [item.musicStyleName, item.styleName, item.name],
    contributorRole: [item.roleName, item.contributorRoleName, item.name],
    trackProperty: [item.trackPropertyName, item.propertyName, item.name],
  };
  const id = ids[kind].map(Number).find(Number.isFinite);
  const name = names[kind].map((value) => String(value ?? "").trim()).find(Boolean);
  if (id == null || !name) return null;
  const groupId = Number(item.contributorRoleGroupId ?? item.roleGroupId);
  return { id, name, groupId: Number.isFinite(groupId) ? groupId : null, raw: item };
}

function requireLookupMatch(items: LookupItem[], value: string, label: string, filter?: (item: LookupItem) => boolean) {
  const candidates = filter ? items.filter(filter) : items;
  const target = normalized(value);
  const exact = candidates.find((item) => normalized(item.name) === target);
  if (exact) return exact;
  const partial = candidates.filter((item) => normalized(item.name).includes(target) || target.includes(normalized(item.name)));
  if (partial.length === 1) return partial[0];
  throw new Error(`${label} '${value}' could not be mapped unambiguously to the provider catalog.`);
}

function writerRoleCandidates(role: ProviderCatalogWriter["role"]) {
  return role === "composer" ? ["composer"] : role === "lyricist" ? ["lyricist", "lyrics", "author"] : ["composer lyricist", "composer and lyricist", "songwriter"];
}

class RevelatorCatalogUpdateClient {
  constructor(private readonly account: DistributionAccount) {}

  private async request(path: string, init: RequestInit = {}) {
    const token = await accessTokenForDistributionAccount(this.account);
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const response = await fetch(`${revelatorV1Base()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}),
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

  private async lookup(path: string, kind: LookupKind) {
    const raw = await this.request(path);
    return recordArray(raw).map((item) => lookupItem(item, kind)).filter((item): item is LookupItem => item !== null);
  }

  private async uploadCover(url: string, filename: string) {
    const source = await fetch(url, { cache: "no-store" });
    if (!source.ok) throw new Error(`Unable to read updated cover artwork from Ensemblis storage (${source.status}).`);
    const blob = await source.blob();
    if (!blob.size) throw new Error("Updated cover artwork is empty.");
    const form = new FormData();
    form.append("file", blob, filename);
    const raw = await this.request("/media/image/upload?cover=true", { method: "POST", body: form });
    const fileId = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String((raw as Record<string, unknown>).fileId ?? "") : "";
    if (!fileId || /^0+$/.test(fileId.replaceAll("-", ""))) throw new Error("Provider cover upload returned no usable file ID.");
    return { fileId, filename: filename.replace(/\.(png|jpeg)$/i, ".jpg") };
  }

  private async artistExternalIds(profiles: ProviderCatalogRelease["artistProfiles"], stores: LookupItem[]) {
    const result: Array<{ profileId: string | null; distributorStoreId: number }> = [];
    for (const profile of profiles) {
      const platform = normalized(profile.platform);
      const store = stores.find((candidate) => {
        const name = normalized(candidate.name);
        if (platform === "spotify") return name === "spotify" || name.startsWith("spotify ");
        if (platform === "apple music" || platform === "apple_music") return name.includes("apple music");
        if (platform === "soundcloud") return name.includes("soundcloud");
        return name === platform;
      });
      if (store) result.push({ profileId: profile.externalArtistId || null, distributorStoreId: store.id });
    }
    return result;
  }

  private contributorPayload(contributors: ProviderCatalogContributor[], roles: LookupItem[]) {
    return contributors.map((contributor) => {
      const role = requireLookupMatch(roles, contributor.role, "Contributor role");
      return { roleId: role.id, artist: { name: contributor.name } };
    });
  }

  private writerPayload(writers: ProviderCatalogWriter[], roles: LookupItem[]) {
    return writers.map((writer) => {
      const publishingRoles = roles.filter((role) => role.groupId === 4);
      const role = writerRoleCandidates(writer.role)
        .map((candidate) => {
          try { return requireLookupMatch(publishingRoles, candidate, "Writer role"); } catch { return null; }
        })
        .find((item): item is LookupItem => item !== null);
      if (!role) throw new Error(`Writer role '${writer.role}' could not be mapped to a provider publishing role.`);
      const rightsId = writer.publishingType === "published" ? 2 : writer.publishingType === "public_domain" ? 3 : 1;
      return {
        composerName: writer.legalName,
        rightsId,
        roleId: role.id,
        share: writer.share,
        ...(rightsId === 2 ? { publisherId: 0, publisherName: writer.publisherName } : {}),
      };
    });
  }

  async updateRelease(input: ProviderCatalogRelease, options: { artworkChanged: boolean }) {
    if (!input.providerReleaseId) throw new Error("Existing provider release ID is required for a catalog correction.");
    const existingRaw = await this.request(`/content/release/${encodeURIComponent(input.providerReleaseId)}`);
    const existing = existingRaw && typeof existingRaw === "object" ? existingRaw as Record<string, unknown> : {};
    const existingTracks = records(existing.tracks) as ExistingProviderTrack[];
    if (existingTracks.length !== input.tracks.length) throw new Error("Provider track count differs from Ensemblis. This correction requires takedown + new release.");
    const providerUpc = String(existing.upc ?? "").trim();
    if (!providerUpc || normalized(providerUpc) !== normalized(input.upc ?? "")) throw new Error("Provider UPC differs from the canonical Ensemblis UPC. In-place correction was blocked.");

    const [languages, musicStyles, roles, trackProperties, stores] = await Promise.all([
      this.lookup("/common/lookup/languages", "language"),
      this.lookup("/common/lookup/musicstyles", "musicStyle"),
      this.lookup("/common/lookup/contributorRoles", "contributorRole"),
      this.lookup("/common/lookup/trackProperties", "trackProperty"),
      this.lookup("/common/lookup/stores?activeOnly=true", "store"),
    ]);
    const releaseLanguage = requireLookupMatch(languages, input.metadataLanguageCode, "Metadata language");
    const musicStyle = requireLookupMatch(musicStyles, input.genre, "Music style");
    const noSpecialProperty = requireLookupMatch(trackProperties, "None", "Track property");
    const includesAiProperty = requireLookupMatch(trackProperties, "Includes AI", "AI track property");
    const externalIds = await this.artistExternalIds(input.artistProfiles, stores);
    const existingImage = existing.image && typeof existing.image === "object" ? existing.image as Record<string, unknown> : {};
    const artwork = options.artworkChanged
      ? await this.uploadCover(input.artworkUrl, input.artworkFilename || "cover.jpg")
      : { fileId: String(existingImage.fileId ?? ""), filename: String(existingImage.filename ?? input.artworkFilename ?? "cover.jpg") };
    if (!artwork.fileId || /^0+$/.test(artwork.fileId.replaceAll("-", ""))) throw new Error("Existing provider cover identity is unavailable; correction was blocked to avoid deleting artwork.");

    const releaseContributors = new Map<string, { roleId: number; artist: { name: string } }>();
    const preparedTracks: Record<string, unknown>[] = [];
    for (let index = 0; index < input.tracks.length; index += 1) {
      const track = input.tracks[index];
      const existingTrack = existingTracks[index];
      const providerTrackId = Number(existingTrack.trackId);
      if (!Number.isFinite(providerTrackId) || providerTrackId <= 0) throw new Error(`Provider track identity is missing at position ${index + 1}.`);
      const versions = records(existingTrack.trackRecordingVersions);
      const stereo = versions.find((version) => Number(version.recordingVersionType) === 1) ?? versions[0];
      if (!stereo) throw new Error(`Provider stereo recording identity is missing for '${track.title}'.`);
      const audioFiles = records(stereo.audioFiles);
      if (!audioFiles.length) throw new Error(`Provider audio file identity is missing for '${track.title}'.`);
      const providerIsrc = String(stereo.isrc ?? existingTrack.isrc ?? "").trim();
      if (!providerIsrc || normalized(providerIsrc) !== normalized(track.isrc ?? "")) throw new Error(`Provider ISRC differs from Ensemblis for '${track.title}'. Correction was blocked.`);
      const audioLanguage = requireLookupMatch(languages, track.audioLanguageCode, "Audio language");
      const metadataLanguage = requireLookupMatch(languages, track.metadataLanguageCode, "Track metadata language");
      const contributors = this.contributorPayload(track.contributors, roles);
      for (const contributor of contributors) {
        const groupId = roles.find((role) => role.id === contributor.roleId)?.groupId;
        if (groupId === 3) releaseContributors.set(`${contributor.roleId}:${normalized(contributor.artist.name)}`, contributor);
      }
      const writers = this.writerPayload(track.writers, roles);
      const writerShare = track.writers.reduce((sum, writer) => sum + writer.share, 0);
      if (Math.abs(writerShare - 100) > 0.01) throw new Error(`Writer shares for '${track.title}' must total 100%.`);
      preparedTracks.push({
        trackId: providerTrackId,
        artistName: track.artistName,
        artistExternalIds: externalIds,
        languageId: metadataLanguage.id,
        audioLanguageId: audioLanguage.id,
        name: track.title,
        version: track.version || undefined,
        contributors,
        explicit: track.explicit,
        trackType: track.origin === "cover" ? 2 : track.origin === "public_domain" ? 3 : 1,
        trackProperties: [track.includesAi ? includesAiProperty.id : noSpecialProperty.id],
        composerContentsDTO: writers,
        tracksLocals: Array.isArray(existingTrack.tracksLocals) ? existingTrack.tracksLocals : [],
        trackRecordingVersions: versions.map((version) => ({
          recordingVersionType: Number(version.recordingVersionType),
          isrc: String(version.isrc ?? "").trim() || null,
          audioFiles: records(version.audioFiles).map((audio) => ({
            audioId: String(audio.audioId ?? ""),
            audioFilename: String(audio.audioFilename ?? ""),
            fileFormat: Number(audio.fileFormat),
          })),
        })),
      });
    }
    if (!releaseContributors.size) throw new Error("At least one Production & Engineering contributor is required before a provider catalog correction.");

    const payload = {
      releaseId: Number(input.providerReleaseId),
      name: input.title,
      artistName: input.artistName,
      artistExternalIds: externalIds,
      contributors: [...releaseContributors.values()],
      copyrightP: `${input.copyrightYear} ${input.productCopyrightHolder}`,
      copyrightC: `${input.copyrightYear} ${input.recordingCopyrightHolder}`,
      hasRecordLabel: Boolean(input.label?.trim()),
      ...(input.label?.trim() ? { labelName: input.label.trim() } : {}),
      previouslyReleased: existing.previouslyReleased === true,
      upc: providerUpc,
      ...(existing.previouslyReleased === true && existing.releaseDate ? { releaseDate: String(existing.releaseDate).slice(0, 10) } : {}),
      languageId: releaseLanguage.id,
      primaryMusicStyleId: musicStyle.id,
      releasesLocals: Array.isArray(existing.releasesLocals) ? existing.releasesLocals : [],
      isCompilation: existing.isCompilation === true,
      image: artwork,
      tracks: preparedTracks,
    };
    const raw = await this.request("/content/release/save", { method: "POST", body: JSON.stringify(payload) });
    const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const providerReleaseId = String(result.releaseId ?? result.id ?? input.providerReleaseId).trim();
    if (providerReleaseId !== String(input.providerReleaseId)) throw new Error("Provider correction returned a different release ID. Ensemblis blocked the result for reconciliation.");
    return { providerReleaseId, raw };
  }
}

export async function updateProviderCatalogRelease(account: DistributionAccount, input: ProviderCatalogRelease, options: { artworkChanged: boolean }) {
  if (account.provider !== "revelator") throw new Error(`Unsupported distribution catalog update provider: ${account.provider}`);
  return new RevelatorCatalogUpdateClient(account).updateRelease(input, options);
}
