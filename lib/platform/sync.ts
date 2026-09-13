import { assertPathFreePortableValue } from "./recordings";
import {
  PROJECT_MUTATION_VERSION,
  parsePortableProjectManifest,
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

const OPERATIONS = new Set<ProjectMutationOperation>([
  "project.title.set",
  "recording.add",
  "recording.remove",
  "recording.metadata.update",
  "analysis.attach",
  "analysis.detach",
  "asset.attach",
  "asset.detach",
  "note.update",
]);
const POLICY_KEYS = ["projectData", "analysis", "artwork", "masters", "stems", "references"] as const;

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

function parseMediaSyncPolicy(value: unknown): MediaSyncPolicy {
  const input = asRecord(value, "sync.mediaSyncPolicy");
  assertKnownKeys(input, POLICY_KEYS, "sync.mediaSyncPolicy");
  const policy = {} as MediaSyncPolicy;
  for (const key of POLICY_KEYS) {
    if (typeof input[key] !== "boolean") throw new Error(`sync.mediaSyncPolicy.${key} must be boolean.`);
    policy[key] = input[key] as boolean;
  }
  return policy;
}

export function parseProjectMutation(value: unknown): ProjectMutation {
  const input = asRecord(value, "mutation");
  assertKnownKeys(input, ["version", "mutationId", "projectId", "baseRevision", "actorId", "createdAt", "operation", "entityId", "payload"], "mutation");
  if (input.version !== PROJECT_MUTATION_VERSION) throw new Error("Unsupported project mutation version.");
  if (typeof input.mutationId !== "string" || !input.mutationId.trim() || input.mutationId.length > 200) {
    throw new Error("Project mutation mutationId is invalid.");
  }
  if (typeof input.projectId !== "string" || !input.projectId.trim() || input.projectId.length > 160) {
    throw new Error("Project mutation projectId is invalid.");
  }
  if (!Number.isInteger(input.baseRevision) || (input.baseRevision as number) < 0) throw new Error("Project mutation base revision is invalid.");
  if (typeof input.createdAt !== "string" || Number.isNaN(Date.parse(input.createdAt))) throw new Error("Project mutation createdAt is invalid.");
  if (typeof input.operation !== "string" || !OPERATIONS.has(input.operation as ProjectMutationOperation)) throw new Error("Project mutation operation is invalid.");
  if (input.actorId != null && (typeof input.actorId !== "string" || input.actorId.length > 200)) throw new Error("Project mutation actorId is invalid.");
  if (input.entityId != null && (typeof input.entityId !== "string" || !input.entityId.trim() || input.entityId.length > 200)) {
    throw new Error("Project mutation entityId is invalid.");
  }
  const payload = asRecord(input.payload, "mutation.payload");
  const mutation: ProjectMutation = {
    version: PROJECT_MUTATION_VERSION,
    mutationId: input.mutationId,
    projectId: input.projectId,
    baseRevision: input.baseRevision as number,
    createdAt: input.createdAt,
    operation: input.operation as ProjectMutationOperation,
    payload: { ...payload },
    ...(input.actorId !== undefined ? { actorId: input.actorId as string | null } : {}),
    ...(input.entityId !== undefined ? { entityId: input.entityId as string | null } : {}),
  };
  projectMutationTarget(mutation);
  assertPathFreePortableValue(mutation, "mutation");
  return mutation;
}

export function assertProjectMutation(mutation: ProjectMutation): void {
  parseProjectMutation(mutation);
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
  return parseProjectMutation({
    version: PROJECT_MUTATION_VERSION,
    mutationId: input.mutationId,
    projectId: input.projectId,
    baseRevision: input.baseRevision,
    operation: input.operation,
    payload: input.payload ?? {},
    entityId: input.entityId,
    actorId: input.actorId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  });
}

export function parseProjectSyncEnvelope(value: unknown): ProjectSyncEnvelope {
  const input = asRecord(value, "sync");
  assertKnownKeys(input, ["version", "projectId", "deviceId", "baseRevision", "mutations", "mediaSyncPolicy"], "sync");
  if (input.version !== PROJECT_SYNC_VERSION) throw new Error("Unsupported project sync version.");
  if (typeof input.projectId !== "string" || !input.projectId.trim() || input.projectId.length > 160) throw new Error("Sync projectId is invalid.");
  if (typeof input.deviceId !== "string" || !input.deviceId.trim() || input.deviceId.length > 200) throw new Error("Sync deviceId is invalid.");
  if (!Number.isInteger(input.baseRevision) || (input.baseRevision as number) < 0) throw new Error("Sync base revision is invalid.");
  if (!Array.isArray(input.mutations)) throw new Error("Sync mutations must be an array.");
  if (input.mutations.length > 500) throw new Error("Sync envelope exceeds the mutation batch limit.");
  const mutations = input.mutations.map(parseProjectMutation);
  for (const mutation of mutations) {
    if (mutation.projectId !== input.projectId) throw new Error("Sync batch contains a mutation for another project.");
  }
  const envelope: ProjectSyncEnvelope = {
    version: PROJECT_SYNC_VERSION,
    projectId: input.projectId,
    deviceId: input.deviceId,
    baseRevision: input.baseRevision as number,
    mutations,
    ...(input.mediaSyncPolicy !== undefined ? { mediaSyncPolicy: parseMediaSyncPolicy(input.mediaSyncPolicy) } : {}),
  };
  assertPathFreePortableValue(envelope, "sync");
  return envelope;
}

export function createProjectSyncEnvelope(input: Omit<ProjectSyncEnvelope, "version">): ProjectSyncEnvelope {
  return parseProjectSyncEnvelope({ version: PROJECT_SYNC_VERSION, ...input });
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
  const canonicalIncoming = parseProjectMutation(incoming);
  const target = projectMutationTarget(canonicalIncoming);
  for (const candidate of appliedSinceBase) {
    const applied = parseProjectMutation(candidate);
    if (applied.projectId !== canonicalIncoming.projectId) continue;
    if (projectMutationTarget(applied) === target) {
      return {
        target,
        incomingMutationId: canonicalIncoming.mutationId,
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
    notes: manifest.notes.map((note) => ({ ...note })),
  };
}

function payloadRecording(mutation: ProjectMutation): ProjectRecording {
  const candidate = asRecord(mutation.payload.recording, "mutation.payload.recording") as ProjectRecording;
  if (candidate.id !== requiredEntityId(mutation)) throw new Error("recording.add entityId must match payload.recording.id.");
  assertProjectRecording(candidate);
  return { ...candidate };
}

function payloadAnalysis(mutation: ProjectMutation): ProjectAnalysisArtifact {
  const candidate = asRecord(mutation.payload.analysis, "mutation.payload.analysis") as ProjectAnalysisArtifact;
  if (candidate.artifactId !== requiredEntityId(mutation)) throw new Error("analysis.attach entityId must match payload.analysis.artifactId.");
  assertProjectAnalysisArtifact(candidate);
  return { ...candidate };
}

function payloadAsset(mutation: ProjectMutation): ProjectAsset {
  const candidate = asRecord(mutation.payload.asset, "mutation.payload.asset") as ProjectAsset;
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
  const current = parsePortableProjectManifest(manifest);
  const incoming = parseProjectMutation(mutation);
  if (incoming.projectId !== current.projectId) throw new Error("Project mutation belongs to another project.");
  if (incoming.baseRevision > current.revision) throw new Error("Project mutation is based on a future revision.");
  if (incoming.baseRevision < current.revision) {
    const appliedSinceBase = options.appliedSinceBase;
    if (!appliedSinceBase) throw new Error("Project mutation is stale and requires semantic rebase context.");
    const conflict = findProjectMutationConflict(incoming, appliedSinceBase);
    if (conflict) throw new Error(`Project mutation conflicts on ${conflict.target}.`);
  }

  const next = cloneManifest(current);
  const payload = incoming.payload;

  switch (incoming.operation) {
    case "project.title.set": {
      next.title = requiredString(payload, "title", 240);
      break;
    }
    case "recording.add": {
      const recording = payloadRecording(incoming);
      if (next.recordings.some((item) => item.id === recording.id)) throw new Error(`Project recording ${recording.id} already exists.`);
      next.recordings.push(recording);
      break;
    }
    case "recording.remove": {
      const recordingId = requiredEntityId(incoming);
      const recording = ensureRecording(next, recordingId);
      next.recordings = next.recordings.filter((item) => item.id !== recordingId);
      next.analysisArtifacts = next.analysisArtifacts.filter((item) => item.recordingFingerprint !== recording.fingerprint);
      next.assets = next.assets.filter((item) => item.recordingFingerprint !== recording.fingerprint);
      break;
    }
    case "recording.metadata.update": {
      const recording = ensureRecording(next, requiredEntityId(incoming));
      if (Object.hasOwn(payload, "displayName")) {
        const displayName = payload.displayName;
        if (displayName != null && typeof displayName !== "string") throw new Error("displayName must be a string or null.");
        if (typeof displayName === "string" && displayName.length > 240) throw new Error("displayName is too long.");
        recording.displayName = displayName == null ? null : displayName;
      }
      if (Object.hasOwn(payload, "mediaPolicy")) {
        const mediaPolicy = payload.mediaPolicy;
        if (mediaPolicy !== "reference" && mediaPolicy !== "managed_copy" && mediaPolicy !== "cloud_optional") throw new Error("mediaPolicy is invalid.");
        recording.mediaPolicy = mediaPolicy;
      }
      assertProjectRecording(recording);
      break;
    }
    case "analysis.attach": {
      const analysis = payloadAnalysis(incoming);
      if (!next.recordings.some((item) => item.fingerprint === analysis.recordingFingerprint)) throw new Error("Analysis artifact references a recording outside the project.");
      if (next.analysisArtifacts.some((item) => item.artifactId === analysis.artifactId)) throw new Error(`Analysis artifact ${analysis.artifactId} already exists.`);
      next.analysisArtifacts.push(analysis);
      break;
    }
    case "analysis.detach": {
      const artifactId = requiredEntityId(incoming);
      if (!next.analysisArtifacts.some((item) => item.artifactId === artifactId)) throw new Error(`Analysis artifact ${artifactId} does not exist.`);
      next.analysisArtifacts = next.analysisArtifacts.filter((item) => item.artifactId !== artifactId);
      break;
    }
    case "asset.attach": {
      const asset = payloadAsset(incoming);
      if (asset.recordingFingerprint && !next.recordings.some((item) => item.fingerprint === asset.recordingFingerprint)) throw new Error("Project asset references a recording outside the project.");
      if (next.assets.some((item) => item.id === asset.id)) throw new Error(`Project asset ${asset.id} already exists.`);
      next.assets.push(asset);
      break;
    }
    case "asset.detach": {
      const assetId = requiredEntityId(incoming);
      if (!next.assets.some((item) => item.id === assetId)) throw new Error(`Project asset ${assetId} does not exist.`);
      next.assets = next.assets.filter((item) => item.id !== assetId);
      break;
    }
    case "note.update": {
      const noteId = requiredEntityId(incoming);
      const text = typeof payload.text === "string" ? payload.text : null;
      if (text == null || text.length > 20_000) throw new Error("note.update requires a text payload up to 20,000 characters.");
      const existing = next.notes.find((note) => note.id === noteId);
      if (existing) {
        existing.text = text;
        existing.updatedAt = incoming.createdAt;
      } else {
        next.notes.push({ id: noteId, text, updatedAt: incoming.createdAt });
      }
      break;
    }
  }

  next.revision = current.revision + 1;
  next.updatedAt = incoming.createdAt;
  return parsePortableProjectManifest(next);
}

export function applyProjectMutationBatch(
  manifest: ProjectManifest,
  mutations: readonly ProjectMutation[],
  appliedSinceBase: readonly ProjectMutation[] = [],
): ProjectManifest {
  let current = parsePortableProjectManifest(manifest);
  const applied = appliedSinceBase.map(parseProjectMutation);
  for (const mutation of mutations) {
    const incoming = parseProjectMutation(mutation);
    current = applyProjectMutation(current, incoming, {
      appliedSinceBase: incoming.baseRevision < current.revision
        ? applied.filter((item) => item.baseRevision >= incoming.baseRevision)
        : undefined,
    });
    applied.push(incoming);
  }
  return current;
}
