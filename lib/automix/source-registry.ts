import type {
  AutoMixSourceKind,
  DjLibrarySourceAdapter,
  DjLibrarySourceIdentity,
  DjLibraryScanResult,
} from "@/lib/automix/source-contract";

export class DjLibrarySourceRegistry<TContext = unknown> {
  private readonly adapters = new Map<AutoMixSourceKind, DjLibrarySourceAdapter<TContext>>();

  register(adapter: DjLibrarySourceAdapter<TContext>) {
    const kind = adapter.descriptor.kind;
    if (this.adapters.has(kind)) throw new Error(`DJ library source adapter ${kind} is already registered.`);
    this.adapters.set(kind, adapter);
    return this;
  }

  get(kind: AutoMixSourceKind) {
    return this.adapters.get(kind) ?? null;
  }

  list() {
    return [...this.adapters.values()];
  }

  async detectAll(context: TContext) {
    return Promise.all(this.list().map(async (adapter) => ({
      descriptor: adapter.descriptor,
      detection: await adapter.detect(context),
    })));
  }

  async scan(kind: AutoMixSourceKind, context: TContext): Promise<DjLibraryScanResult> {
    const adapter = this.get(kind);
    if (!adapter) throw new Error(`No DJ library source adapter registered for ${kind}.`);
    const source = await adapter.describeSource(context);
    const [tracks, playlists, revision] = await Promise.all([
      adapter.scanTracks(context),
      adapter.scanPlaylists(context),
      adapter.getRevision(context),
    ]);
    return { source: { ...source, revision }, tracks, playlists, revision };
  }

  async describeAvailableSources(context: TContext): Promise<readonly DjLibrarySourceIdentity[]> {
    const detections = await this.detectAll(context);
    return detections.flatMap(({ detection }) => (
      detection.status === "available" && detection.source ? [detection.source] : []
    ));
  }
}
