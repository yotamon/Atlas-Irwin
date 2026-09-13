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

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${field}.${key} is not supported.`);
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
}

function assertIsoDate(value: unknown, field: string): asserts value is string {
  assertNonEmpty(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO date-time.`);
}

function parseProjectRecording(value: unknown): ProjectRecording {
  const input = asRecord(value, "recording");
  assertKnownKeys(input, ["id", "fingerprint", "displayName", "mediaPolicy"], "recording");
  assertNonEmpty(input.id, "recording.id");
  assertRecordingFingerprint(input.fingerprint, "recording.fingerprint");
  if (input.displayName != null && typeof input.displayName !== "string") throw new Error("recording.displayName must be a string or null.");
  if (typeof input.displayName === "string" && input.displayName.length > 240) throw new Error("recording.displayName is too long.");
  if (input.mediaPolicy != null && (typeof input.mediaPolicy !== "string" || !MEDIA_POLICIES.has(input.mediaPolicy))) {
    throw new Error("recording.mediaPolicy is invalid.");
  }
  const recording: ProjectRecording = {
    id: input.id,
    fingerprint: input.fingerprint,
    ...(input.displayName !== undefined ? { displayName: input.displayName as string | null } : {}),
    ...(input.mediaPolicy !== undefined ? { mediaPolicy: input.mediaPolicy as ProjectRecording["mediaPolicy"] } : {}),
  };
  assertPathFreePortableValue(recording, "recording");
  return recording;
}

function parseProjectAnalysisArtifact(value: unknown): ProjectAnalysisArtifact {
  const input = asRecord(value, "analysis");
  assertKnownKeys(input, [
    "artifactId",
    "recordingFingerprint",
    "processorId",
    "processorVersion",
    "modelId",
    "modelVersion",
    "schemaVersion",
    "parametersHash",
  ], "analysis");
  for (const field of ["artifactId", "processorId", "processorVersion", "modelId", "modelVersion", "schemaVersion"] as const) {
    assertNonEmpty(input[field], `analysis.${field}`);
  }
  assertRecordingFingerprint(input.recordingFingerprint, "analysis.recordingFingerprint");
  assertRecordingFingerprint(input.parametersHash, "analysis.parametersHash");
  const artifact: ProjectAnalysisArtifact = {
    artifactId: input.artifactId as string,
    recordingFingerprint: input.recordingFingerprint,
    processorId: input.processorId as string,
    processorVersion: input.processorVersion as string,
    modelId: input.modelId as string,
    modelVersion: input.modelVersion as string,
    schemaVersion: input.schemaVersion as string,
    parametersHash: input.parametersHash,
  };
  assertPathFreePortableValue(artifact, "analysis");
  return artifact;
}

function parseProjectAsset(value: unknown): ProjectAsset {
  const input = asRecord(value, "asset");
  assertKnownKeys(input, ["id", "kind", "recordingFingerprint"], "asset");
  assertNonEmpty(input.id, "asset.id");
  assertNonEmpty(input.kind, "asset.kind");
  if (input.recordingFingerprint != null) assertRecordingFingerprint(input.recordingFingerprint, "asset.recordingFingerprint");
  const asset: ProjectAsset = {
    id: input.id,
    kind: input.kind,
    ...(input.recordingFingerprint !== undefined
      ? { recordingFingerprint: input.recordingFingerprint as RecordingFingerprint | null }
      : {}),
  };
  assertPathFreePortableValue(asset, "asset");
  return asset;
}

function parseProjectNote(value: unknown): ProjectNote {
  const input = asRecord(value, "note");
  assertKnownKeys(input, ["id", "text", "updatedAt"], "note");
  assertNonEmpty(input.id, "note.id");
  if (typeof input.text !== "string" || input.text.length > 20_000) throw new Error("note.text is invalid.");
  assertIsoDate(input.updatedAt, "note.updatedAt");
  const note: ProjectNote = { id: input.id, text: input.text, updatedAt: input.updatedAt };
  assertPathFreePortableValue(note, "note");
  return note;
}

export function assertProjectRecording(recording: ProjectRecording): void {
  parseProjectRecording(recording);
}

export function assertProjectAnalysisArtifact(artifact: ProjectAnalysisArtifact): void {
  parseProjectAnalysisArtifact(artifact);
}

export function assertProjectAsset(asset: ProjectAsset): void {
  parseProjectAsset(asset);
}

export function assertProjectNote(note: ProjectNote): void {
  parseProjectNote(note);
}

export function parsePortableProjectManifest(value: unknown): ProjectManifest {
  const input = asRecord(value, "project");
  assertKnownKeys(input, ["version", "projectId", "title", "revision", "recordings", "analysisArtifacts", "assets", "notes", "updatedAt"], "project");
  if (input.version !== PROJECT_MANIFEST_VERSION) throw new Error("Unsupported Ensemblis project format.");
  assertNonEmpty(input.projectId, "projectId");
  assertNonEmpty(input.title, "title");
  if (input.title.length > 240) throw new Error("Portable project title is too long.");
  if (!Number.isInteger(input.revision) || (input.revision as number) < 0) throw new Error("Portable project revision is invalid.");
  assertIsoDate(input.updatedAt, "updatedAt");
  if (!Array.isArray(input.recordings)) throw new Error("project.recordings must be an array.");
  if (!Array.isArray(input.analysisArtifacts)) throw new Error("project.analysisArtifacts must be an array.");
  if (!Array.isArray(input.assets)) throw new Error("project.assets must be an array.");
  if (input.notes !== undefined && !Array.isArray(input.notes)) throw new Error("project.notes must be an array when present.");

  const manifest: ProjectManifest = {
    version: PROJECT_MANIFEST_VERSION,
    projectId: input.projectId,
    title: input.title,
    revision: input.revision as number,
    recordings: input.recordings.map(parseProjectRecording),
    analysisArtifacts: input.analysisArtifacts.map(parseProjectAnalysisArtifact),
    assets: input.assets.map(parseProjectAsset),
    notes: (input.notes ?? []).map(parseProjectNote),
    updatedAt: input.updatedAt,
  };

  const recordingIds = new Set<string>();
  for (const recording of manifest.recordings) {
    if (recordingIds.has(recording.id)) throw new Error(`Duplicate project recording id: ${recording.id}`);
    recordingIds.add(recording.id);
  }
  const artifactIds = new Set<string>();
  for (const artifact of manifest.analysisArtifacts) {
    if (artifactIds.has(artifact.artifactId)) throw new Error(`Duplicate analysis artifact id: ${artifact.artifactId}`);
    artifactIds.add(artifact.artifactId);
  }
  const assetIds = new Set<string>();
  for (const asset of manifest.assets) {
    if (assetIds.has(asset.id)) throw new Error(`Duplicate project asset id: ${asset.id}`);
    assetIds.add(asset.id);
  }
  const noteIds = new Set<string>();
  for (const note of manifest.notes) {
    if (noteIds.has(note.id)) throw new Error(`Duplicate project note id: ${note.id}`);
    noteIds.add(note.id);
  }

  assertPathFreePortableValue(manifest, "project");
  return manifest;
}

export function assertPortableProjectManifest(manifest: ProjectManifest): void {
  parsePortableProjectManifest(manifest);
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
  return parsePortableProjectManifest(manifest);
}
