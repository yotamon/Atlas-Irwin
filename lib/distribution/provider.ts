import type { DistributionIssue } from "./domain";

export type ProviderValidationResult = { ready: boolean; issues: DistributionIssue[]; raw: unknown };
export type ProviderDelivery = { storeId: string; storeName: string; providerStatus: string | number | null; url?: string | null; raw?: unknown };
export type ProviderStore = { id: number; name: string; active: boolean; category?: string | null; raw?: unknown };
export type ProviderCatalogWriter = { legalName: string; role: "composer" | "lyricist" | "composer_lyricist"; share: number; publishingType: "copyright_control" | "published" | "public_domain"; publisherName?: string | null };
export type ProviderCatalogContributor = { name: string; role: string };
export type ProviderCatalogTrack = {
  title: string;
  version?: string | null;
  artistName: string;
  audioUrl: string;
  audioFilename: string;
  metadataLanguageCode: string;
  audioLanguageCode: string;
  explicit: boolean;
  origin: "original" | "cover" | "public_domain";
  isrc?: string | null;
  includesAi: boolean;
  writers: ProviderCatalogWriter[];
  contributors: ProviderCatalogContributor[];
};
export type ProviderCatalogRelease = {
  providerReleaseId?: string | null;
  title: string;
  artistName: string;
  genre: string;
  label?: string | null;
  upc?: string | null;
  previouslyReleased: boolean;
  originalReleaseDate?: string | null;
  releaseDate: string;
  metadataLanguageCode: string;
  copyrightYear: number;
  productCopyrightHolder: string;
  recordingCopyrightHolder: string;
  artworkUrl: string;
  artworkFilename: string;
  artistProfiles: Array<{ platform: string; externalArtistId: string | null }>;
  tracks: ProviderCatalogTrack[];
};
export type ProviderPreparationResult = { providerReleaseId: string; raw: unknown };
export type ProviderReleaseConfiguration = { releaseDate: string; ugcEnabled: boolean };

export interface DistributionProvider {
  readonly id: string;
  listStores(): Promise<ProviderStore[]>;
  prepareRelease(input: ProviderCatalogRelease): Promise<ProviderPreparationResult>;
  configureRelease(providerReleaseId: string, options: ProviderReleaseConfiguration): Promise<unknown>;
  validateRelease(providerReleaseId: string, storeIds?: number[]): Promise<ProviderValidationResult>;
  submitRelease(providerReleaseId: string, storeIds: number[]): Promise<void>;
  getDistributionStatus(providerReleaseId: string): Promise<ProviderDelivery[]>;
}

type CachedProviderToken = { cacheKey: string; token: string; expiresAt: number };
type LookupKind = "store" | "language" | "musicStyle" | "contributorRole" | "trackProperty";
type LookupItem = { id: number; name: string; groupId?: number | null; raw: Record<string, unknown> };
type MonetizationPolicy = { id: number; name: string; code: string; storeId: number; order: number | null };
type ReleaseAssets = { releaseAssetId: number | null; trackAssetIds: number[] };

let cachedProviderToken: CachedProviderToken | null = null;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeFilename(value: string, fallback: string) {
  const cleaned = value.split(/[?#]/, 1)[0]?.split("/").pop()?.trim() ?? "";
  return cleaned || fallback;
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
  if (body && typeof body === "object" && "error" in body) return String((body as { error?: unknown }).error);
  return `Distribution provider request failed (${status}).`;
}

function lookupItem(item: Record<string, unknown>, kind: LookupKind): LookupItem | null {
  const ids: Record<LookupKind, unknown[]> = {
    store: [item.distributorStoreId, item.storeId, item.id],
    language: [item.languageId, item.id],
    musicStyle: [item.musicStyleId, item.styleId, item.id],
    contributorRole: [item.roleId, item.contributorRoleId, item.id],
    trackProperty: [item.trackPropertyId, item.id],
  };
  const names: Record<LookupKind, unknown[]> = {
    store: [item.distributorStoreName, item.storeName, item.name],
    language: [item.languageCode, item.isoCode, item.code, item.name, item.languageName],
    musicStyle: [item.musicStyleName, item.styleName, item.name],
    contributorRole: [item.roleName, item.contributorRoleName, item.name],
    trackProperty: [item.name, item.trackPropertyName],
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

function releaseAssets(raw: unknown): ReleaseAssets {
  if (!raw || typeof raw !== "object") return { releaseAssetId: null, trackAssetIds: [] };
  const release = raw as Record<string, unknown>;
  const releaseAssetIdValue = Number(release.assetId ?? release.releaseAssetId);
  const tracks = Array.isArray(release.tracks)
    ? release.tracks
    : Array.isArray(release.releaseTracks)
      ? release.releaseTracks
      : [];
  const trackAssetIds = tracks
    .filter((track): track is Record<string, unknown> => Boolean(track && typeof track === "object"))
    .map((track) => Number(track.assetId ?? track.trackAssetId))
    .filter(Number.isFinite);
  return {
    releaseAssetId: Number.isFinite(releaseAssetIdValue) ? releaseAssetIdValue : null,
    trackAssetIds: [...new Set(trackAssetIds)],
  };
}

function monetizationPolicies(raw: unknown): MonetizationPolicy[] {
  return recordArray(raw).flatMap((item) => {
    const id = Number(item.monetizationPolicyId ?? item.policyId);
    const storeId = Number(item.distributorStoreId);
    if (!Number.isFinite(id) || !Number.isFinite(storeId)) return [];
    const orderValue = Number(item.order ?? item.orderNum);
    return [{
      id,
      storeId,
      name: String(item.name ?? ""),
      code: String(item.code ?? item.name ?? ""),
      order: Number.isFinite(orderValue) ? orderValue : null,
    }];
  });
}

function choosePolicyForStore(policies: MonetizationPolicy[], ugcEnabled: boolean, storeName: string | null) {
  if (!policies.length) return null;
  if (ugcEnabled) {
    const defaults = policies.filter((policy) => policy.order === 1);
    if (defaults.length === 1) return defaults[0];
    if (defaults.length > 1) throw new Error(`The provider returned multiple default monetization policies for ${storeName ?? "a UGC store"}.`);
    throw new Error(`The provider returned no default monetization policy for ${storeName ?? "a UGC store"}.`);
  }

  const isTikTok = normalized(storeName ?? "").includes("tiktok");
  if (isTikTok) {
    const libraryOnly = policies.filter((policy) => {
      const text = normalized(`${policy.name} ${policy.code}`);
      return text.includes("library only") || text.includes("no tiktok scanning");
    });
    if (libraryOnly.length === 1) return libraryOnly[0];
  }
  const notEligible = policies.filter((policy) => normalized(`${policy.name} ${policy.code}`).includes("not eligible"));
  if (notEligible.length === 1) return notEligible[0];
  throw new Error(`Ensemblis could not map a safe non-monetizing policy for ${storeName ?? "a UGC store"}.`);
}

export class RevelatorProvider implements DistributionProvider {
  readonly id = "revelator";
  private readonly staticToken: string;
  private readonly partnerApiKey: string;
  private readonly partnerUserId: string;
  private readonly v1Base: string;
  private readonly v2Base: string;

  constructor(options?: { token?: string; partnerApiKey?: string; partnerUserId?: string; v1Base?: string; v2Base?: string }) {
    this.staticToken = options?.token ?? process.env.REVELATOR_ACCESS_TOKEN?.trim() ?? "";
    this.partnerApiKey = options?.partnerApiKey ?? process.env.REVELATOR_PARTNER_API_KEY?.trim() ?? "";
    this.partnerUserId = options?.partnerUserId ?? process.env.REVELATOR_PARTNER_USER_ID?.trim() ?? "";
    this.v1Base = (options?.v1Base ?? process.env.REVELATOR_API_V1_BASE_URL ?? "https://api.revelator.com").replace(/\/$/, "");
    this.v2Base = (options?.v2Base ?? process.env.REVELATOR_API_V2_BASE_URL ?? "https://platform.revelator.com").replace(/\/$/, "");
    if (!this.staticToken && !(this.partnerApiKey && this.partnerUserId)) throw new Error("Distribution provider credentials are not configured.");
  }

  private tokenCacheKey() {
    return `${this.v1Base}|${this.partnerUserId}`;
  }

  private async getAccessToken(forceRefresh = false) {
    if (this.staticToken) return this.staticToken;
    const cacheKey = this.tokenCacheKey();
    if (!forceRefresh && cachedProviderToken?.cacheKey === cacheKey && cachedProviderToken.expiresAt > Date.now() + 60_000) return cachedProviderToken.token;
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
    cachedProviderToken = { cacheKey, token, expiresAt: Date.now() + 7.5 * 60 * 60 * 1000 };
    return token;
  }

  private async request(base: string, path: string, init: RequestInit = {}, retried = false): Promise<unknown> {
    const token = await this.getAccessToken(retried);
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}),
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

  private async lookup(path: string, kind: LookupKind) {
    const raw = await this.request(this.v1Base, path);
    return recordArray(raw).map((item) => lookupItem(item, kind)).filter((item): item is LookupItem => item !== null);
  }

  private async uploadRemoteFile(url: string, filename: string, kind: "audio" | "cover") {
    const source = await fetch(url, { cache: "no-store" });
    if (!source.ok) throw new Error(`Unable to read ${kind} asset from Ensemblis storage (${source.status}).`);
    const blob = await source.blob();
    if (!blob.size) throw new Error(`${kind === "audio" ? "Audio" : "Cover"} asset is empty.`);
    const form = new FormData();
    form.append("file", blob, filename);
    if (kind === "cover") {
      const raw = await this.request(this.v1Base, "/media/image/upload?cover=true", { method: "POST", body: form });
      const fileId = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String((raw as Record<string, unknown>).fileId ?? "") : "";
      if (!fileId || fileId === ZERO_GUID) throw new Error("Provider cover upload did not return a valid file ID.");
      return { fileId, filename: filename.replace(/\.(png|jpeg)$/i, ".jpg") };
    }
    const raw = await this.request(this.v1Base, "/media/audio/upload", { method: "POST", body: form });
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const fileId = String(record.fileId ?? "");
    const returnedFilename = String(record.filename ?? filename);
    if (!fileId || fileId === ZERO_GUID) throw new Error("Provider audio upload did not return a valid file ID.");
    return { fileId, filename: returnedFilename };
  }

  private async artistExternalIds(profiles: ProviderCatalogRelease["artistProfiles"], stores: ProviderStore[]) {
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

  private async contributorPayload(contributors: ProviderCatalogContributor[], roles: LookupItem[]) {
    const result: Array<{ roleId: number; artist: { name: string } }> = [];
    for (const contributor of contributors) {
      const role = requireLookupMatch(roles, contributor.role, "Contributor role");
      result.push({ roleId: role.id, artist: { name: contributor.name } });
    }
    return result;
  }

  private async writerPayload(writers: ProviderCatalogWriter[], roles: LookupItem[]) {
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

  async listStores(): Promise<ProviderStore[]> {
    const raw = await this.request(this.v1Base, "/common/lookup/stores?activeOnly=true");
    const stores: ProviderStore[] = [];
    for (const item of recordArray(raw)) {
      const parsed = lookupItem(item, "store");
      if (!parsed) continue;
      stores.push({
        id: parsed.id,
        name: parsed.name,
        active: item.isActive !== false && item.active !== false && String(item.status ?? "").toLowerCase() !== "disabled",
        category: item.category == null ? null : String(item.category),
        raw: item,
      });
    }
    return stores.sort((a, b) => a.name.localeCompare(b.name));
  }

  async prepareRelease(input: ProviderCatalogRelease): Promise<ProviderPreparationResult> {
    if (!input.tracks.length) throw new Error("At least one track is required to prepare a provider release.");
    const [languages, musicStyles, roles, trackProperties, stores] = await Promise.all([
      this.lookup("/common/lookup/languages", "language"),
      this.lookup("/common/lookup/musicstyles", "musicStyle"),
      this.lookup("/common/lookup/contributorRoles", "contributorRole"),
      this.lookup("/common/lookup/trackProperties", "trackProperty"),
      this.listStores(),
    ]);
    const metadataLanguage = requireLookupMatch(languages, input.metadataLanguageCode, "Metadata language");
    const musicStyle = requireLookupMatch(musicStyles, input.genre, "Music style");
    const noSpecialProperty = requireLookupMatch(trackProperties, "None", "Track property");
    const includesAiProperty = requireLookupMatch(trackProperties, "Includes AI", "AI track property");
    const externalIds = await this.artistExternalIds(input.artistProfiles, stores);
    const artwork = await this.uploadRemoteFile(input.artworkUrl, safeFilename(input.artworkFilename, "cover.jpg"), "cover");
    const preparedTracks: Record<string, unknown>[] = [];
    const releaseContributors: Array<{ roleId: number; artist: { name: string } }> = [];

    for (const track of input.tracks) {
      const ext = track.audioFilename.toLowerCase().split(".").pop();
      if (ext !== "wav" && ext !== "flac") throw new Error(`Track '${track.title}' must use a lossless WAV or FLAC master for distribution.`);
      const audioLanguage = requireLookupMatch(languages, track.audioLanguageCode, "Audio language");
      const trackMetadataLanguage = requireLookupMatch(languages, track.metadataLanguageCode, "Track metadata language");
      const audio = await this.uploadRemoteFile(track.audioUrl, safeFilename(track.audioFilename, `${track.title}.${ext}`), "audio");
      const contributors = await this.contributorPayload(track.contributors, roles);
      const productionContributors = contributors.filter((contributor) => roles.find((role) => role.id === contributor.roleId)?.groupId === 3);
      if (!productionContributors.length) throw new Error(`Track '${track.title}' needs at least one Production & Engineering credit before provider preparation.`);
      if (!releaseContributors.length) releaseContributors.push(...productionContributors);
      const writers = await this.writerPayload(track.writers, roles);
      const writerShare = track.writers.reduce((sum, writer) => sum + writer.share, 0);
      if (Math.abs(writerShare - 100) > 0.01) throw new Error(`Writer shares for '${track.title}' must total 100%.`);
      const fileFormat = audio.filename.toLowerCase().endsWith(".flac") ? 2 : 1;
      preparedTracks.push({
        artistName: track.artistName,
        artistExternalIds: externalIds,
        languageId: trackMetadataLanguage.id,
        audioLanguageId: audioLanguage.id,
        name: track.title,
        version: track.version || undefined,
        contributors,
        explicit: track.explicit,
        trackType: track.origin === "cover" ? 2 : track.origin === "public_domain" ? 3 : 1,
        trackProperties: [track.includesAi ? includesAiProperty.id : noSpecialProperty.id],
        composerContentsDTO: writers,
        trackRecordingVersions: [{
          recordingVersionType: 1,
          isrc: track.isrc || null,
          audioFiles: [{ audioId: audio.fileId, audioFilename: audio.filename, fileFormat }],
        }],
      });
    }

    if (!releaseContributors.length) throw new Error("At least one Production & Engineering contributor is required before provider release creation.");
    const requestedReleaseId = input.providerReleaseId ? Number(input.providerReleaseId) : 0;
    if (input.providerReleaseId && !Number.isFinite(requestedReleaseId)) throw new Error("Existing provider release ID is invalid.");
    const payload = {
      releaseId: requestedReleaseId,
      name: input.title,
      artistName: input.artistName,
      artistExternalIds: externalIds,
      contributors: releaseContributors,
      copyrightP: `${input.copyrightYear} ${input.productCopyrightHolder}`,
      copyrightC: `${input.copyrightYear} ${input.recordingCopyrightHolder}`,
      hasRecordLabel: Boolean(input.label?.trim()),
      ...(input.label?.trim() ? { labelName: input.label.trim() } : {}),
      previouslyReleased: input.previouslyReleased,
      ...(input.previouslyReleased && input.upc ? { upc: input.upc } : {}),
      ...(input.previouslyReleased && input.originalReleaseDate ? { releaseDate: input.originalReleaseDate } : {}),
      languageId: metadataLanguage.id,
      primaryMusicStyleId: musicStyle.id,
      releasesLocals: [],
      isCompilation: false,
      image: artwork,
      tracks: preparedTracks,
    };
    const raw = await this.request(this.v1Base, "/content/release/save", { method: "POST", body: JSON.stringify(payload) });
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const providerReleaseId = String(record.releaseId ?? record.id ?? input.providerReleaseId ?? "").trim();
    if (!providerReleaseId || providerReleaseId === "0") throw new Error("Provider release save succeeded without returning a usable release ID.");
    return { providerReleaseId, raw };
  }

  private async configureDefaultPricing(providerReleaseId: string) {
    const raw = await this.request(this.v2Base, `/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/pricing-tiers/options`);
    const selections = recordArray(raw).flatMap((store) => {
      const storeId = Number(store.distributorStoreId);
      if (!Number.isFinite(storeId)) return [];
      const pick = (value: unknown) => Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          .filter((item) => item.isDefault === true && String(item.resolutionType ?? "").toLowerCase() === "standard")
        : [];
      const trackDefaults = pick(store.trackPrices);
      const releaseDefaults = pick(store.releasePrices);
      if (trackDefaults.length > 1 || releaseDefaults.length > 1) throw new Error(`Provider pricing options for store ${storeId} contain multiple standard defaults.`);
      if (!trackDefaults.length && !releaseDefaults.length) return [];
      return [{
        distributorStoreId: storeId,
        trackPrices: trackDefaults.map((item) => ({ priceTierId: Number(item.priceTierId) })).filter((item) => Number.isFinite(item.priceTierId)),
        releasePrices: releaseDefaults.map((item) => ({ priceTierId: Number(item.priceTierId) })).filter((item) => Number.isFinite(item.priceTierId)),
      }];
    });
    if (selections.length) {
      await this.request(this.v2Base, `/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/pricing-tiers`, {
        method: "PUT",
        body: JSON.stringify(selections),
      });
    }
    return selections;
  }

  private async configureMonetization(providerReleaseId: string, ugcEnabled: boolean) {
    const [releaseRaw, policiesRaw, stores] = await Promise.all([
      this.request(this.v1Base, `/content/release/${encodeURIComponent(providerReleaseId)}`),
      this.request(this.v2Base, "/supply-chain/v1/monetization-policies"),
      this.listStores(),
    ]);
    const assets = releaseAssets(releaseRaw);
    if (!assets.trackAssetIds.length) throw new Error("Provider release does not expose track asset IDs required for UGC policy configuration.");
    const policies = monetizationPolicies(policiesRaw);
    if (!policies.length) return [];
    const byStore = new Map<number, MonetizationPolicy[]>();
    for (const policy of policies) byStore.set(policy.storeId, [...(byStore.get(policy.storeId) ?? []), policy]);
    const selectedPolicies = [...byStore.entries()].map(([storeId, storePolicies]) => {
      const storeName = stores.find((store) => store.id === storeId)?.name ?? null;
      return choosePolicyForStore(storePolicies, ugcEnabled, storeName);
    }).filter((policy): policy is MonetizationPolicy => policy !== null);
    const payload = assets.trackAssetIds.map((assetId) => ({
      assetId,
      monetizationPolicies: selectedPolicies.map((policy) => ({ monetizationPolicyId: policy.id })),
    }));
    if (selectedPolicies.length) {
      await this.request(this.v2Base, `/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/monetization-policies`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    }
    return payload;
  }

  async configureRelease(providerReleaseId: string, options: ProviderReleaseConfiguration) {
    // Revelator's hybrid V1/V2 workflow requires the V1 retail write first. Any later V1 retail call
    // can wipe V2 settings, so every retry deliberately reapplies all V2 configuration afterward.
    const retail = await this.request(this.v1Base, "/content/release/retail/save", {
      method: "POST",
      body: JSON.stringify({ releaseId: Number(providerReleaseId), saleStartDate: options.releaseDate }),
    });
    const territories = await this.request(this.v2Base, `/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/territories-clearances`, {
      method: "PUT",
      body: JSON.stringify({ release: [], assets: [] }),
    });
    const [pricing, monetization] = await Promise.all([
      this.configureDefaultPricing(providerReleaseId),
      this.configureMonetization(providerReleaseId, options.ugcEnabled),
    ]);
    return { retail, territories, pricing, monetization };
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
    return distributions
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
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
