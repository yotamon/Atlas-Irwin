import type {
  AutoMixExecutionTarget,
  AutoMixSourceKind,
  AutoMixSourceTrackRef,
} from "@/lib/automix/source-contract";

export const AUTOMIX_EXECUTION_CONTRACT_VERSION = "ensemblis.automix-execution-adapter.v1" as const;

export type AutoMixExecutionDescriptor = {
  id: string;
  displayName: string;
  target: AutoMixExecutionTarget;
  supportedSourceKinds: readonly AutoMixSourceKind[];
  supportsPreview: boolean;
  supportsFullRender: boolean;
};

export type AutoMixExecutionManifest = {
  renderEngineContractVersion: string;
  planHash: string;
  sourceRefs: readonly AutoMixSourceTrackRef[];
  outputFormat: "mp3" | "wav";
};

export type ResolvedExecutionSource = {
  trackId: string;
  source: AutoMixSourceTrackRef;
  uri: string;
  fingerprint?: string | null;
};

export type AutoMixExecutionRequest<TContext = unknown> = {
  context: TContext;
  manifest: AutoMixExecutionManifest;
};

export interface AutoMixExecutionAdapter<TContext = unknown> {
  readonly version: typeof AUTOMIX_EXECUTION_CONTRACT_VERSION;
  readonly descriptor: AutoMixExecutionDescriptor;
  canExecute(manifest: AutoMixExecutionManifest): boolean;
  resolveSources(request: AutoMixExecutionRequest<TContext>): Promise<readonly ResolvedExecutionSource[]>;
}

type CloudResolver<TContext> = (
  context: TContext,
  source: AutoMixSourceTrackRef,
) => Promise<ResolvedExecutionSource | null>;

export class CloudCatalogExecutionAdapter<TContext = unknown> implements AutoMixExecutionAdapter<TContext> {
  readonly version = AUTOMIX_EXECUTION_CONTRACT_VERSION;
  readonly descriptor: AutoMixExecutionDescriptor = {
    id: "cloud-catalog",
    displayName: "Ensemblis Cloud Catalog",
    target: "cloud",
    supportedSourceKinds: ["artist_catalog"],
    supportsPreview: true,
    supportsFullRender: true,
  };

  constructor(private readonly resolver: CloudResolver<TContext>) {}

  canExecute(manifest: AutoMixExecutionManifest) {
    return manifest.sourceRefs.length > 0 && manifest.sourceRefs.every((source) => (
      source.executionTarget === "cloud"
      && source.kind === "artist_catalog"
      && source.availability !== "missing"
      && source.availability !== "offline"
    ));
  }

  async resolveSources(request: AutoMixExecutionRequest<TContext>) {
    if (!this.canExecute(request.manifest)) {
      throw new Error("CloudCatalogExecutionAdapter cannot execute this manifest.");
    }
    const resolved = await Promise.all(request.manifest.sourceRefs.map((source) => this.resolver(request.context, source)));
    if (resolved.some((source) => !source)) {
      throw new Error("One or more cloud catalog sources could not be resolved.");
    }
    return resolved as ResolvedExecutionSource[];
  }
}

export type DeviceLibraryExecutionContext = {
  deviceId: string;
  /**
   * The gateway verifies the exact content identity on the paired device. It never returns a local
   * path. A false result means the frozen MixPlan must not execute on that device.
   */
  verifySource(source: AutoMixSourceTrackRef): Promise<boolean>;
};

const DEVICE_SOURCE_KINDS = new Set<AutoMixSourceKind>([
  "local_library",
  "rekordbox",
  "traktor",
]);

function opaqueDeviceUri(deviceId: string, source: AutoMixSourceTrackRef) {
  const librarySourceId = source.librarySourceId ?? "";
  return `device://${encodeURIComponent(deviceId)}/${encodeURIComponent(librarySourceId)}/${encodeURIComponent(source.trackId)}`;
}

export class DeviceLibraryExecutionAdapter implements AutoMixExecutionAdapter<DeviceLibraryExecutionContext> {
  readonly version = AUTOMIX_EXECUTION_CONTRACT_VERSION;
  readonly descriptor: AutoMixExecutionDescriptor = {
    id: "native-library-bridge",
    displayName: "Ensemblis Native Library Bridge",
    target: "device",
    supportedSourceKinds: ["local_library", "rekordbox", "traktor"],
    supportsPreview: true,
    supportsFullRender: true,
  };

  canExecute(manifest: AutoMixExecutionManifest) {
    return manifest.sourceRefs.length > 0 && manifest.sourceRefs.every((source) => (
      source.executionTarget === "device"
      && DEVICE_SOURCE_KINDS.has(source.kind)
      && source.availability !== "missing"
      && source.availability !== "offline"
      && Boolean(source.librarySourceId)
      && Boolean(source.recordingFingerprint?.startsWith("sha256:"))
      && Boolean(source.revision)
    ));
  }

  async resolveSources(request: AutoMixExecutionRequest<DeviceLibraryExecutionContext>) {
    if (!this.canExecute(request.manifest)) {
      throw new Error("DeviceLibraryExecutionAdapter cannot execute this manifest.");
    }
    const resolved: ResolvedExecutionSource[] = [];
    for (const source of request.manifest.sourceRefs) {
      if (!(await request.context.verifySource(source))) {
        throw new Error(`Device source ${source.trackId} no longer matches the frozen recording identity.`);
      }
      resolved.push({
        trackId: source.trackId,
        source,
        uri: opaqueDeviceUri(request.context.deviceId, source),
        fingerprint: source.recordingFingerprint,
      });
    }
    return resolved;
  }
}

export type HybridDeviceExecutionContext = {
  deviceId: string;
  verifyDeviceSource(source: AutoMixSourceTrackRef): Promise<boolean>;
  /** Resolves a catalog master to a short-lived remote URI. Local paths are never returned here. */
  resolveCatalogSource(source: AutoMixSourceTrackRef): Promise<ResolvedExecutionSource | null>;
};

export class HybridDeviceExecutionAdapter implements AutoMixExecutionAdapter<HybridDeviceExecutionContext> {
  readonly version = AUTOMIX_EXECUTION_CONTRACT_VERSION;
  readonly descriptor: AutoMixExecutionDescriptor = {
    id: "hybrid-library-bridge",
    displayName: "Ensemblis Hybrid Library Bridge",
    target: "device",
    supportedSourceKinds: ["artist_catalog", "local_library", "rekordbox", "traktor"],
    supportsPreview: true,
    supportsFullRender: true,
  };

  canExecute(manifest: AutoMixExecutionManifest) {
    let hasCloud = false;
    let hasDevice = false;
    if (manifest.sourceRefs.length < 2) return false;
    for (const source of manifest.sourceRefs) {
      if (source.availability === "missing" || source.availability === "offline") return false;
      if (source.executionTarget === "cloud") {
        if (source.kind !== "artist_catalog") return false;
        hasCloud = true;
      } else if (source.executionTarget === "device") {
        if (
          !DEVICE_SOURCE_KINDS.has(source.kind)
          || !source.librarySourceId
          || !source.recordingFingerprint?.startsWith("sha256:")
          || !source.revision
        ) return false;
        hasDevice = true;
      } else {
        return false;
      }
    }
    return hasCloud && hasDevice;
  }

  async resolveSources(request: AutoMixExecutionRequest<HybridDeviceExecutionContext>) {
    if (!this.canExecute(request.manifest)) {
      throw new Error("HybridDeviceExecutionAdapter cannot execute this manifest.");
    }
    const resolved: ResolvedExecutionSource[] = [];
    for (const source of request.manifest.sourceRefs) {
      if (source.executionTarget === "device") {
        if (!(await request.context.verifyDeviceSource(source))) {
          throw new Error(`Device source ${source.trackId} no longer matches the frozen recording identity.`);
        }
        resolved.push({
          trackId: source.trackId,
          source,
          uri: opaqueDeviceUri(request.context.deviceId, source),
          fingerprint: source.recordingFingerprint,
        });
        continue;
      }
      const catalog = await request.context.resolveCatalogSource(source);
      if (!catalog) throw new Error(`Catalog source ${source.trackId} could not be resolved for hybrid execution.`);
      resolved.push(catalog);
    }
    return resolved;
  }
}

export class AutoMixExecutionAdapterRegistry<TContext = unknown> {
  private readonly adapters = new Map<string, AutoMixExecutionAdapter<TContext>>();

  register(adapter: AutoMixExecutionAdapter<TContext>) {
    if (adapter.version !== AUTOMIX_EXECUTION_CONTRACT_VERSION) {
      throw new Error("Unsupported AutoMix execution adapter contract.");
    }
    if (this.adapters.has(adapter.descriptor.id)) {
      throw new Error(`Execution adapter ${adapter.descriptor.id} is already registered.`);
    }
    this.adapters.set(adapter.descriptor.id, adapter);
    return this;
  }

  resolve(manifest: AutoMixExecutionManifest, preferredTarget?: AutoMixExecutionTarget) {
    const candidates = [...this.adapters.values()].filter((adapter) => (
      (!preferredTarget || adapter.descriptor.target === preferredTarget)
      && adapter.canExecute(manifest)
    ));
    if (candidates.length === 0) return null;
    if (candidates.length > 1) candidates.sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
    return candidates[0] ?? null;
  }
}
