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
    if (candidates.length > 1) {
      candidates.sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
    }
    return candidates[0] ?? null;
  }
}
