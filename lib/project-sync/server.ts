import "server-only";

import { isDeepStrictEqual } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import { parsePortableProjectManifest, type ProjectManifest, type ProjectMutation } from "@/lib/platform/projects";
import {
  applyProjectMutation,
  findProjectMutationConflict,
  parseProjectMutation,
  parseProjectSyncEnvelope,
  projectMutationTarget,
  type ProjectSyncEnvelope,
} from "@/lib/platform/sync";
import type { Json } from "@/types/database";
import type {
  ProjectMutationRow,
  ProjectReplicaRow,
  ProjectSyncDatabase,
} from "@/types/project-sync-database";

export type ProjectSyncScope = {
  workspaceId: string;
  artistId: string | null;
  actorId: string;
};

export class ProjectSyncRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type ProjectSyncClient = SupabaseClient<ProjectSyncDatabase>;

type ReplicaState = {
  row: ProjectReplicaRow;
  manifest: ProjectManifest;
};

type RpcState = {
  status: string;
  currentRevision: number | null;
  logFloorRevision: number | null;
  manifest: ProjectManifest | null;
};

const MUTATION_PAGE_SIZE = 500;
const MAX_CAS_RETRIES = 3;

export function createProjectSyncServiceClient(): ProjectSyncClient {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for project sync operations.");
  return createClient<ProjectSyncDatabase>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function portableJson(value: ProjectManifest | Record<string, unknown>): Json {
  return value as unknown as Json;
}

function validateProjectId(projectId: string): string {
  const value = projectId.trim();
  if (!value || value.length > 160) throw new ProjectSyncRequestError("A valid projectId is required.");
  return value;
}

function parseReplica(row: ProjectReplicaRow): ReplicaState {
  const manifest = parsePortableProjectManifest(row.manifest);
  if (manifest.projectId !== row.project_id || manifest.revision !== row.current_revision) {
    throw new Error("Project replica snapshot does not match its database revision.");
  }
  return { row, manifest };
}

function rowToMutation(row: ProjectMutationRow): ProjectMutation {
  return parseProjectMutation({
    version: "ensemblis.project-mutation.v1",
    mutationId: row.mutation_id,
    projectId: row.project_id,
    baseRevision: row.base_revision,
    actorId: row.actor_id,
    createdAt: row.created_at,
    operation: row.operation,
    entityId: row.entity_id,
    payload: row.payload,
  });
}

async function loadReplica(
  client: ProjectSyncClient,
  scope: ProjectSyncScope,
  projectId: string,
): Promise<ReplicaState | null> {
  const { data, error } = await client
    .from("ensemblis_project_replicas")
    .select("workspace_id,project_id,artist_id,created_by,manifest,current_revision,log_floor_revision,created_at,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.artist_id != null && scope.artistId != null && data.artist_id !== scope.artistId) {
    throw new ProjectSyncRequestError("Project replica belongs to another artist context.", 403);
  }
  return parseReplica(data);
}

async function loadStoredMutation(
  client: ProjectSyncClient,
  scope: ProjectSyncScope,
  projectId: string,
  mutationId: string,
): Promise<ProjectMutationRow | null> {
  const { data, error } = await client
    .from("ensemblis_project_mutations")
    .select("workspace_id,project_id,mutation_id,actor_id,device_id,base_revision,applied_revision,operation,entity_id,target,payload,created_at,applied_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("project_id", projectId)
    .eq("mutation_id", mutationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadMutationsSince(
  client: ProjectSyncClient,
  scope: ProjectSyncScope,
  projectId: string,
  revision: number,
): Promise<ProjectMutationRow[]> {
  const rows: ProjectMutationRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from("ensemblis_project_mutations")
      .select("workspace_id,project_id,mutation_id,actor_id,device_id,base_revision,applied_revision,operation,entity_id,target,payload,created_at,applied_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("project_id", projectId)
      .gt("applied_revision", revision)
      .order("applied_revision", { ascending: true })
      .range(offset, offset + MUTATION_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < MUTATION_PAGE_SIZE) break;
    offset += MUTATION_PAGE_SIZE;
  }
  return rows;
}

function sameStoredMutation(
  row: ProjectMutationRow,
  mutation: ProjectMutation,
  deviceId: string,
  actorId: string,
): boolean {
  const stored = rowToMutation(row);
  return row.device_id === deviceId
    && stored.actorId === actorId
    && stored.mutationId === mutation.mutationId
    && stored.projectId === mutation.projectId
    && stored.baseRevision === mutation.baseRevision
    && stored.operation === mutation.operation
    && (stored.entityId ?? null) === (mutation.entityId ?? null)
    && projectMutationTarget(stored) === projectMutationTarget(mutation)
    && Date.parse(stored.createdAt) === Date.parse(mutation.createdAt)
    && isDeepStrictEqual(stored.payload, mutation.payload);
}

async function commitMutation(
  client: ProjectSyncClient,
  scope: ProjectSyncScope,
  deviceId: string,
  expectedRevision: number,
  mutation: ProjectMutation,
  nextManifest: ProjectManifest,
): Promise<RpcState> {
  const { data, error } = await client.rpc("commit_ensemblis_project_mutation_v1", {
    p_workspace_id: scope.workspaceId,
    p_project_id: mutation.projectId,
    p_actor_id: scope.actorId,
    p_device_id: deviceId,
    p_expected_revision: expectedRevision,
    p_mutation_id: mutation.mutationId,
    p_base_revision: mutation.baseRevision,
    p_operation: mutation.operation,
    p_entity_id: mutation.entityId ?? null,
    p_target: projectMutationTarget(mutation),
    p_payload: portableJson(mutation.payload),
    p_created_at: mutation.createdAt,
    p_next_manifest: portableJson(nextManifest),
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Project mutation RPC returned no state.");
  return {
    status: row.status,
    currentRevision: row.current_revision,
    logFloorRevision: row.log_floor_revision,
    manifest: row.manifest == null ? null : parsePortableProjectManifest(row.manifest),
  };
}

export async function bootstrapProjectReplica(
  scope: ProjectSyncScope,
  manifestValue: unknown,
) {
  const manifest = parsePortableProjectManifest(manifestValue);
  const client = createProjectSyncServiceClient();
  const { data, error } = await client.rpc("bootstrap_ensemblis_project_replica_v1", {
    p_workspace_id: scope.workspaceId,
    p_artist_id: scope.artistId,
    p_project_id: manifest.projectId,
    p_actor_id: scope.actorId,
    p_manifest: portableJson(manifest),
    p_revision: manifest.revision,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row || row.current_revision == null || row.log_floor_revision == null || row.manifest == null) {
    throw new Error("Project bootstrap RPC returned incomplete state.");
  }
  return {
    status: row.status,
    projectId: manifest.projectId,
    currentRevision: row.current_revision,
    logFloorRevision: row.log_floor_revision,
    manifest: parsePortableProjectManifest(row.manifest),
  };
}

export async function getProjectSyncState(
  scope: ProjectSyncScope,
  projectIdInput: string,
  sinceRevision?: number,
) {
  const projectId = validateProjectId(projectIdInput);
  if (sinceRevision !== undefined && (!Number.isInteger(sinceRevision) || sinceRevision < 0)) {
    throw new ProjectSyncRequestError("sinceRevision must be a non-negative integer.");
  }
  const client = createProjectSyncServiceClient();
  const replica = await loadReplica(client, scope, projectId);
  if (!replica) return { status: "not_found" as const, projectId };

  const snapshotRequired = sinceRevision !== undefined
    && (sinceRevision < replica.row.log_floor_revision || sinceRevision > replica.row.current_revision);
  const rows = sinceRevision === undefined || snapshotRequired
    ? []
    : await loadMutationsSince(client, scope, projectId, sinceRevision);

  return {
    status: "ok" as const,
    projectId,
    currentRevision: replica.row.current_revision,
    logFloorRevision: replica.row.log_floor_revision,
    snapshotRequired,
    manifest: replica.manifest,
    mutations: rows.map((row) => ({
      appliedRevision: row.applied_revision,
      deviceId: row.device_id,
      mutation: rowToMutation(row),
    })),
  };
}

export async function syncProjectEnvelope(
  scope: ProjectSyncScope,
  envelopeValue: unknown,
) {
  const envelope: ProjectSyncEnvelope = parseProjectSyncEnvelope(envelopeValue);
  const client = createProjectSyncServiceClient();
  let replica = await loadReplica(client, scope, envelope.projectId);
  if (!replica) return { status: "not_found" as const, projectId: envelope.projectId };

  const appliedMutationIds: string[] = [];
  for (const sourceMutation of envelope.mutations) {
    const mutation = parseProjectMutation({ ...sourceMutation, actorId: scope.actorId });
    let committed = false;

    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
      if (mutation.baseRevision < replica.row.log_floor_revision) {
        return {
          status: "snapshot_required" as const,
          projectId: envelope.projectId,
          currentRevision: replica.row.current_revision,
          logFloorRevision: replica.row.log_floor_revision,
          manifest: replica.manifest,
          appliedMutationIds,
        };
      }
      if (mutation.baseRevision > replica.row.current_revision) {
        return {
          status: "revision_conflict" as const,
          projectId: envelope.projectId,
          currentRevision: replica.row.current_revision,
          logFloorRevision: replica.row.log_floor_revision,
          manifest: replica.manifest,
          appliedMutationIds,
        };
      }

      const stored = await loadStoredMutation(client, scope, envelope.projectId, mutation.mutationId);
      if (stored) {
        if (!sameStoredMutation(stored, mutation, envelope.deviceId, scope.actorId)) {
          throw new ProjectSyncRequestError("mutationId was already used for different content.", 409);
        }
        appliedMutationIds.push(mutation.mutationId);
        committed = true;
        break;
      }

      const rowsSinceBase = mutation.baseRevision < replica.row.current_revision
        ? await loadMutationsSince(client, scope, envelope.projectId, mutation.baseRevision)
        : [];
      const appliedSinceBase = rowsSinceBase.map(rowToMutation);
      const conflict = findProjectMutationConflict(mutation, appliedSinceBase);
      if (conflict) {
        return {
          status: "semantic_conflict" as const,
          projectId: envelope.projectId,
          conflict,
          currentRevision: replica.row.current_revision,
          logFloorRevision: replica.row.log_floor_revision,
          manifest: replica.manifest,
          appliedMutationIds,
        };
      }

      const nextManifest = applyProjectMutation(replica.manifest, mutation, {
        appliedSinceBase: mutation.baseRevision < replica.row.current_revision ? appliedSinceBase : undefined,
      });
      const result = await commitMutation(
        client,
        scope,
        envelope.deviceId,
        replica.row.current_revision,
        mutation,
        nextManifest,
      );

      if (result.status === "applied" || result.status === "idempotent") {
        if (result.currentRevision == null || result.logFloorRevision == null || !result.manifest) {
          throw new Error("Project mutation commit returned incomplete state.");
        }
        replica = {
          row: {
            ...replica.row,
            current_revision: result.currentRevision,
            log_floor_revision: result.logFloorRevision,
            manifest: portableJson(result.manifest),
          },
          manifest: result.manifest,
        };
        appliedMutationIds.push(mutation.mutationId);
        committed = true;
        break;
      }

      if (result.status === "revision_conflict") {
        const refreshed = await loadReplica(client, scope, envelope.projectId);
        if (!refreshed) return { status: "not_found" as const, projectId: envelope.projectId };
        replica = refreshed;
        continue;
      }

      if (result.status === "not_found") return { status: "not_found" as const, projectId: envelope.projectId };
      throw new Error(`Unexpected project mutation status: ${result.status}`);
    }

    if (!committed) {
      return {
        status: "revision_conflict" as const,
        projectId: envelope.projectId,
        currentRevision: replica.row.current_revision,
        logFloorRevision: replica.row.log_floor_revision,
        manifest: replica.manifest,
        appliedMutationIds,
      };
    }
  }

  return {
    status: "synced" as const,
    projectId: envelope.projectId,
    currentRevision: replica.row.current_revision,
    logFloorRevision: replica.row.log_floor_revision,
    manifest: replica.manifest,
    appliedMutationIds,
  };
}
