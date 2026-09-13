import { assertPathFreePortableValue, assertRecordingFingerprint, type RecordingFingerprint } from "./recordings";

export const PROJECT_MANIFEST_VERSION = "ensemblis.project.v1" as const;
export const PROJECT_MUTATION_VERSION = "ensemblis.project-mutation.v1" as const;

export type ProjectRecording = {
  id: string;
  fingerprint: RecordingFingerprint;
  displayName?: string | null;
  mediaPolicy?: "reference" | "managed_copy" | "cloud_optional";
};

export type ProjectAnalysisArtifact = {
  artifactId: string;
  recordingFingerprint: RecordingFingerprint;
  processorId: string;
  processorVersion: string;
  modelId: string;
  modelVersion: string;
  schemaVersion: string;
  parametersHash: RecordingFingerprint;
};

export type ProjectAsset = {
  id: string;
  kind: string;
  recordingFingerprint?: RecordingFingerprint | null;
};

export type ProjectNote = {
  id: string;
  text: string;
  updatedAt: string;
};

export type ProjectManifest = {
  version: typeof PROJECT_MANIFEST_VERSION;
  projectId: string;
  title: string;
  revision: number;
  recordings: ProjectRecording[];
  analysisArtifacts: ProjectAnalysisArtifact[];
  assets: ProjectAsset[];
  notes: ProjectNote[];
  updatedAt: string;
};

export type ProjectMutationOperation =
  | "project.title.set"
  | "recording.add"
  | "recording.remove"
  | "recording.metadata.update"
  | "analysis.attach"
  | "analysis.detach"
  | "asset.attach"
  | "asset.detach"
  | "note.update";

export type ProjectMutation = {
  version: typeof PROJECT_MUTATION_VERSION;
  mutationId: string;
  projectId: string;
  baseRevision: number;
  actorId?: string | null;
  createdAt: string;
  operation: ProjectMutationOperation;
  entityId?: string | null;
  payload: Record<string, unknown>;
};

const MEDIA_POLICIES = new Set(["reference", "managed_copy", "cloud_optional"]);

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
}

function assertIsoDate(value: unknown, field: string): asserts value is string {
  assertNonEmpty(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO date-time.`);
}

export function assertProjectRecording(recording: ProjectRecording): void {
  assertNonEmpty(recording.id, "recording.id");
  assertRecordingFingerprint(recording.fingerprint, "recording.fingerprint");
  if (recording.displayName != null && recording.displayName.length > 240) throw new Error("recording.displayName is too long.");
  if (recording.mediaPolicy != null && !MEDIA_POLICIES.has(recording.mediaPolicy)) throw new Error("recording.mediaPolicy is invalid.");
  assertPathFreePortableValue(recording, "recording");
}

export function assertProjectAnalysisArtifact(artifact: ProjectAnalysisArtifact): void {
  for (const [field, value] of [
    ["analysis.artifactId", artifact.artifactId],
    ["analysis.processorId", artifact.processorId],
    ["analysis.processorVersion", artifact.processorVersion],
    ["analysis.modelId", artifact.modelId],
    ["analysis.modelVersion", artifact.modelVersion],
    ["analysis.schemaVersion", artifact.schemaVersion],
  ] as const) assertNonEmpty(value, field);
  assertRecordingFingerprint(artifact.recordingFingerprint, "analysis.recordingFingerprint");
  assertRecordingFingerprint(artifact.parametersHash, "analysis.parametersHash");
  assertPathFreePortableValue(artifact, "analysis");
}

export function assertProjectAsset(asset: ProjectAsset): void {
  assertNonEmpty(asset.id, "asset.id");
  assertNonEmpty(asset.kind, "asset.kind");
  if (asset.recordingFingerprint != null) assertRecordingFingerprint(asset.recordingFingerprint, "asset.recordingFingerprint");
  assertPathFreePortableValue(asset, "asset");
}

export function assertProjectNote(note: ProjectNote): void {
  assertNonEmpty(note.id, "note.id");
  if (typeof note.text !== "string" || note.text.length > 20_000) throw new Error("note.text is invalid.");
  assertIsoDate(note.updatedAt, "note.updatedAt");
  assertPathFreePortableValue(note, "note");
}

export function assertPortableProjectManifest(manifest: ProjectManifest): void {
  if (manifest.version !== PROJECT_MANIFEST_VERSION) throw new Error("Unsupported Ensemblis project format.");
  assertNonEmpty(manifest.projectId, "projectId");
  assertNonEmpty(manifest.title, "title");
  if (manifest.title.length > 240) throw new Error("Portable project title is too long.");
  if (!Number.isInteger(manifest.revision) || manifest.revision < 0) throw new Error("Portable project revision is invalid.");
  assertIsoDate(manifest.updatedAt, "updatedAt");

  const recordingIds = new Set<string>();
  for (const recording of manifest.recordings) {
    assertProjectRecording(recording);
    if (recordingIds.has(recording.id)) throw new Error(`Duplicate project recording id: ${recording.id}`);
    recordingIds.add(recording.id);
  }

  const artifactIds = new Set<string>();
  for (const artifact of manifest.analysisArtifacts) {
    assertProjectAnalysisArtifact(artifact);
    if (artifactIds.has(artifact.artifactId)) throw new Error(`Duplicate analysis artifact id: ${artifact.artifactId}`);
    artifactIds.add(artifact.artifactId);
  }

  const assetIds = new Set<string>();
  for (const asset of manifest.assets) {
    assertProjectAsset(asset);
    if (assetIds.has(asset.id)) throw new Error(`Duplicate project asset id: ${asset.id}`);
    assetIds.add(asset.id);
  }

  const noteIds = new Set<string>();
  for (const note of manifest.notes ?? []) {
    assertProjectNote(note);
    if (noteIds.has(note.id)) throw new Error(`Duplicate project note id: ${note.id}`);
    noteIds.add(note.id);
  }

  assertPathFreePortableValue(manifest, "project");
}

export function createProjectManifest(input: { projectId: string; title: string; now?: Date }): ProjectManifest {
  const manifest: ProjectManifest = {
    version: PROJECT_MANIFEST_VERSION,
    projectId: input.projectId,
    title: input.title.trim(),
    revision: 0,
    recordings: [],
    analysisArtifacts: [],
    assets: [],
    notes: [],
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  assertPortableProjectManifest(manifest);
  return manifest;
}
