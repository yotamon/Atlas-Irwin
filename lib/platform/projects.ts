import { assertPathFreePortableValue, assertRecordingFingerprint, type RecordingFingerprint } from "./recordings";

export const PROJECT_MANIFEST_VERSION = "ensemblis.project.v1" as const;
export const PROJECT_MUTATION_VERSION = "ensemblis.project-mutation.v1" as const;

export type ProjectRecording = {
  id: string;
  fingerprint: RecordingFingerprint;
  displayName?: string | null;
  mediaPolicy?: "reference" | "managed_copy" | "cloud_optional";
};

export type ProjectManifest = {
  version: typeof PROJECT_MANIFEST_VERSION;
  projectId: string;
  title: string;
  revision: number;
  recordings: ProjectRecording[];
  analysisArtifacts: Array<{
    artifactId: string;
    recordingFingerprint: RecordingFingerprint;
    processorId: string;
    schemaVersion: string;
  }>;
  assets: Array<{
    id: string;
    kind: string;
    recordingFingerprint?: RecordingFingerprint | null;
  }>;
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

export function assertPortableProjectManifest(manifest: ProjectManifest): void {
  if (manifest.version !== PROJECT_MANIFEST_VERSION) throw new Error("Unsupported Ensemblis project format.");
  if (!manifest.projectId.trim() || !manifest.title.trim()) throw new Error("Portable projects require projectId and title.");
  if (!Number.isInteger(manifest.revision) || manifest.revision < 0) throw new Error("Portable project revision is invalid.");
  for (const recording of manifest.recordings) assertRecordingFingerprint(recording.fingerprint);
  for (const analysis of manifest.analysisArtifacts) assertRecordingFingerprint(analysis.recordingFingerprint);
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
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  assertPortableProjectManifest(manifest);
  return manifest;
}
