import { assertPathFreePortableValue } from "./recordings";
import {
  PROJECT_MUTATION_VERSION,
  assertPortableProjectManifest,
  assertProjectAnalysisArtifact,
  assertProjectAsset,
  assertProjectRecording,
  type ProjectAnalysisArtifact,
  type ProjectAsset,
  type ProjectManifest,
  type ProjectMutation,
  type ProjectMutationOperation,
  type ProjectRecording,
} from "./projects";

export const PROJECT_SYNC_VERSION = "ensemblis.project-sync.v2" as const;

export type MediaSyncPolicy = {
  projectData: boolean;
  analysis: boolean;
  artwork: boolean;
  masters: boolean;
  stems: boolean;
  references: boolean;
};

export const DEFAULT_MEDIA_SYNC_POLICY: MediaSyncPolicy = {
  projectData: true,
  analysis: true,
  artwork: true,
  masters: false,
  stems: false,
  references: false,
};

export type ProjectSyncEnvelope = {
  version: typeof PROJECT_SYNC_VERSION;
  projectId: string;
  deviceId: string;
  baseRevision: number;
  mutations: ProjectMutation[];
  mediaSyncPolicy?: MediaSyncPolicy;
};

export type ProjectMutationConflict = {
  target: string;
  incomingMutationId: string;
  conflictingMutationId: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredEntityId(mutation: ProjectMutation): string {
  const entityId = mutation.entityId?.trim();
  if (!entityId) throw new Error(`${mutation.operation} requires entityId.`);
  return entityId;
}

function requiredString(payload: Record<string, unknown>, key: string, max: number): string {
  const value = typeof payload[key] === "string" ? payload[key].trim() : "";
  if (!value) throw new Error(`${key} is required.`);
  if (value.length > max) throw new Error(`${key} is too long.`);
  return value;
}

function assertProjectMutation(mutation: ProjectMutation): void {
  if (mutation.version !== PROJECT_MUTATION_VERSION) throw new Error("Unsupported project mutation version.");
  if (!mutation.mutationId.trim() || !mutation.projectId.trim()) throw new Error("Project mutations require mutationId and projectId.");
  if (!Number.isInteger(mutation.baseRevision) || mutation.baseRevision < 0) throw new Error("Project mutation base revision is invalid.");
  if (Number.isNaN(Date.parse(mutation.createdAt))) throw new Error("Project mutation createdAt is invalid.");
  projectMutationTarget(mutation);
  assertPathFreePortableValue(mutation, "mutation");
}

export function createProjectMutation(input: {
  mutationId: string;
  projectId: string;
  baseRevision: number;
  operation: ProjectMutationOperation;
  payload?: Record<string, unknown>;
  entityId?: string | null;
  actorId?: string | null;
  createdAt?: Date;
}): ProjectMutation {
  const mutation: ProjectMutation = {
    version: PROJECT_MUTATION_VERSION,
    mutationId: input.mutationId,
    projectId: input.projectId,
    baseRevision: input.baseRevision,
    operation: input.operation,
    payload: input.payload ?? {},
    entityId: input.entityId,
    actorId: input.actorId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
  assertProjectMutation(mutation);
  return mutation;
}

export function createProjectSyncEnvelope(input: Omit<ProjectSyncEnvelope, "version">): ProjectSyncEnvelope {
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) throw new Error("Sync base revision is invalid.");
  if (!input.projectId.trim() || !input.deviceId.trim()) throw new Error("Sync requires projectId and deviceId.");
  if (input.mutations.length > 500) throw new Error("Sync envelope exceeds the mutation batch limit.");
  for (const mutation of input.mutations) {
    assertProjectMutation(mutation);
    if (mutation.projectId !== input.projectId) throw new Error("Sync batch contains a mutation for another project.");
  }
  const envelope: ProjectSyncEnvelope = { version: PROJECT_SYNC_VERSION, ...input };
  assertPathFreePortableValue(envelope, "sync");
  return envelope;
}

export function projectMutationTarget(mutation: ProjectMutation): string {
  switch (mutation.operation) {
    case "project.title.set":
      return "project:title";
    case "recording.add":
    case "recording.remove":
    case "recording.metadata.update":
      return `recording:${requiredEntityId(mutation)}`;
    case "analysis.attach":
    case "analysis.detach":
      return `analysis:${requiredEntityId(mutation)}`;
    case "asset.attach":
    case "asset.detach":
      return `asset:${requiredEntityId(mutation)}`;
    case "note.update":
      return `note:${requiredEntityId(mutation)}`;
  }
}

export function findProjectMutationConflict(
  incoming: ProjectMutation,
  appliedSinceBase: readonly ProjectMutation[],
): ProjectMutationConflict | null {
  assertProjectMutation(incoming);
  const target = projectMutationTarget(incoming);
  for (const applied of appliedSinceBase) {
    assertProjectMutation(applied);
    if (applied.projectId !== incoming.projectId) continue;
    if (projectMutationTarget(applied) === target) {
      return {
        target,
        incomingMutationId: incoming.mutationId,
        conflictingMutationId: applied.mutationId,
      };
    }
  }
  return null;
}

export function canRebaseProjectMutation(
  incoming: ProjectMutation,
  appliedSinceBase: readonly ProjectMutation[],
): boolean {
  return findProjectMutationConflict(incoming, appliedSinceBase) === null;
}

function cloneManifest(manifest: ProjectManifest): ProjectManifest {
  return {
    ...manifest,
    recordings: manifest.recordings.map((recording) => ({ ...recording })),
    analysisArtifacts: manifest.analysisArtifacts.map((artifact) => ({ ...artifact })),
    assets: manifest.assets.map((asset) => ({ ...asset })),
    notes: (manifest.notes ?? []).map((note) => ({ ...note })),
  };
}

function payloadRecording(mutation: ProjectMutation): ProjectRecording {
  const candidate = record(mutation.payload.recording) as ProjectRecording;
  if (candidate.id !== requiredEntityId(mutation)) throw new Error("recording.add entityId must match payload.recording.id.");
  assertProjectRecording(candidate);
  return { ...candidate };
}

function payloadAnalysis(mutation: ProjectMutation): ProjectAnalysisArtifact {
  const candidate = record(mutation.payload.analysis) as ProjectAnalysisArtifact;
  if (candidate.artifactId !== requiredEntityId(mutation)) throw new Error("analysis.attach entityId must match payload.analysis.artifactId.");
  assertProjectAnalysisArtifact(candidate);
  return { ...candidate };
}

function payloadAsset(mutation: ProjectMutation): ProjectAsset {
  const candidate = record(mutation.payload.asset) as ProjectAsset;
  if (candidate.id !== requiredEntityId(mutation)) throw new Error("asset.attach entityId must match payload.asset.id.");
  assertProjectAsset(candidate);
  return { ...candidate };
}

function ensureRecording(manifest: ProjectManifest, recordingId: string): ProjectRecording {
  const recording = manifest.recordings.find((item) => item.id === recordingId);
  if (!recording) throw new Error(`Project recording ${recordingId} does not exist.`);
  return recording;
}

export function applyProjectMutation(
  manifest: ProjectManifest,
  mutation: ProjectMutation,
  options: { appliedSinceBase?: readonly ProjectMutation[] } = {},
): ProjectManifest {
  assertPortableProjectManifest(manifest);
  assertProjectMutation(mutation);
  if (mutation.projectId !== manifest.projectId) throw new Error("Project mutation belongs to another project.");
  if (mutation.baseRevision > manifest.revision) throw new Error("Project mutation is based on a future revision.");
  if (mutation.baseRevision < manifest.revision) {
    const appliedSinceBase = options.appliedSinceBase;
    if (!appliedSinceBase) throw new Error("Project mutation is stale and requires semantic rebase context.");
    const conflict = findProjectMutationConflict(mutation, appliedSinceBase);
    if (conflict) throw new Error(`Project mutation conflicts on ${conflict.target}.`);
  }

  const next = cloneManifest(manifest);
  const payload = record(mutation.payload);

  switch (mutation.operation) {
    case "project.title.set": {
      next.title = requiredString(payload, "title", 240);
      break;
    }
    case "recording.add": {
      const recording = payloadRecording(mutation);
      if (next.recordings.some((item) => item.id === recording.id)) throw new Error(`Project recording ${recording.id} already exists.`);
      next.recordings.push(recording);
      break;
    }
    case "recording.remove": {
      const recordingId = requiredEntityId(mutation);
      const recording = ensureRecording(next, recordingId);
      next.recordings = next.recordings.filter((item) => item.id !== recordingId);
      next.analysisArtifacts = next.analysisArtifacts.filter((item) => item.recordingFingerprint !== recording.fingerprint);
      next.assets = next.assets.filter((item) => item.recordingFingerprint !== recording.fingerprint);
      break;
    }
    case "recording.metadata.update": {
      const recording = ensureRecording(next, requiredEntityId(mutation));
      if (Object.hasOwn(payload, "displayName")) {
        const displayName = payload.displayName;
        if (displayName != null && typeof displayName !== "string") throw new Error("displayName must be a string or null.");
        recording.displayName = displayName == null ? null : displayName.slice(0, 240);
      }
      if (Object.hasOwn(payload, "mediaPolicy")) {
        const mediaPolicy = payload.mediaPolicy;
        if (mediaPolicy !== "reference" && mediaPolicy !== "managed_copy" && mediaPolicy !== "cloud_optional") {
          throw new Error("mediaPolicy is invalid.");
        }
        recording.mediaPolicy = mediaPolicy;
      }
      assertProjectRecording(recording);
      break;
    }
    case "analysis.attach": {
      const analysis = payloadAnalysis(mutation);
      if (!next.recordings.some((item) => item.fingerprint === analysis.recordingFingerprint)) {
        throw new Error("Analysis artifact references a recording outside the project.");
      }
      if (next.analysisArtifacts.some((item) => item.artifactId === analysis.artifactId)) throw new Error(`Analysis artifact ${analysis.artifactId} already exists.`);
      next.analysisArtifacts.push(analysis);
      break;
    }
    case "analysis.detach": {
      const artifactId = requiredEntityId(mutation);
      if (!next.analysisArtifacts.some((item) => item.artifactId === artifactId)) throw new Error(`Analysis artifact ${artifactId} does not exist.`);
      next.analysisArtifacts = next.analysisArtifacts.filter((item) => item.artifactId !== artifactId);
      break;
    }
    case "asset.attach": {
      const asset = payloadAsset(mutation);
      if (asset.recordingFingerprint && !next.recordings.some((item) => item.fingerprint === asset.recordingFingerprint)) {
        throw new Error("Project asset references a recording outside the project.");
      }
      if (next.assets.some((item) => item.id === asset.id)) throw new Error(`Project asset ${asset.id} already exists.`);
      next.assets.push(asset);
      break;
    }
    case "asset.detach": {
      const assetId = requiredEntityId(mutation);
      if (!next.assets.some((item) => item.id === assetId)) throw new Error(`Project asset ${assetId} does not exist.`);
      next.assets = next.assets.filter((item) => item.id !== assetId);
      break;
    }
    case "note.update": {
      const noteId = requiredEntityId(mutation);
      const text = typeof payload.text === "string" ? payload.text : null;
      if (text == null || text.length > 20_000) throw new Error("note.update requires a text payload up to 20,000 characters.");
      const existing = next.notes.find((note) => note.id === noteId);
      if (existing) {
        existing.text = text;
        existing.updatedAt = mutation.createdAt;
      } else {
        next.notes.push({ id: noteId, text, updatedAt: mutation.createdAt });
      }
      break;
    }
  }

  next.revision = manifest.revision + 1;
  next.updatedAt = mutation.createdAt;
  assertPortableProjectManifest(next);
  return next;
}

export function applyProjectMutationBatch(
  manifest: ProjectManifest,
  mutations: readonly ProjectMutation[],
  appliedSinceBase: readonly ProjectMutation[] = [],
): ProjectManifest {
  let current = manifest;
  const applied = [...appliedSinceBase];
  for (const mutation of mutations) {
    current = applyProjectMutation(current, mutation, {
      appliedSinceBase: mutation.baseRevision < current.revision
        ? applied.filter((item) => item.baseRevision >= mutation.baseRevision)
        : undefined,
    });
    applied.push(mutation);
  }
  return current;
}
