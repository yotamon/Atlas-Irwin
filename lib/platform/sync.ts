import { assertPathFreePortableValue } from "./recordings";
import { PROJECT_MUTATION_VERSION, type ProjectMutation, type ProjectMutationOperation } from "./projects";

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
  assertPathFreePortableValue(mutation, "mutation");
  return mutation;
}

export function createProjectSyncEnvelope(input: Omit<ProjectSyncEnvelope, "version">): ProjectSyncEnvelope {
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) throw new Error("Sync base revision is invalid.");
  if (input.mutations.length > 500) throw new Error("Sync envelope exceeds the mutation batch limit.");
  const envelope: ProjectSyncEnvelope = { version: PROJECT_SYNC_VERSION, ...input };
  assertPathFreePortableValue(envelope, "sync");
  return envelope;
}
