import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ProjectReplicaRow = {
  workspace_id: string;
  project_id: string;
  artist_id: string | null;
  created_by: string;
  manifest: Json;
  current_revision: number;
  log_floor_revision: number;
  created_at: string;
  updated_at: string;
};

export type ProjectMutationRow = {
  workspace_id: string;
  project_id: string;
  mutation_id: string;
  actor_id: string;
  device_id: string;
  base_revision: number;
  applied_revision: number;
  operation: string;
  entity_id: string | null;
  target: string;
  payload: Json;
  created_at: string;
  applied_at: string;
};

type ProjectReplicaRpcResult = {
  status: "created" | "existing" | "bootstrap_conflict" | "applied" | "idempotent" | "revision_conflict" | "not_found";
  current_revision: number | null;
  log_floor_revision: number | null;
  manifest: Json | null;
};

type ExistingTables = Database["public"]["Tables"];
type ExistingFunctions = Database["public"]["Functions"];

export type ProjectSyncDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: ExistingTables & {
      ensemblis_project_replicas: Table<ProjectReplicaRow>;
      ensemblis_project_mutations: Table<ProjectMutationRow>;
    };
    Functions: ExistingFunctions & {
      bootstrap_ensemblis_project_replica_v1: {
        Args: {
          p_workspace_id: string;
          p_artist_id: string | null;
          p_project_id: string;
          p_actor_id: string;
          p_manifest: Json;
          p_revision: number;
        };
        Returns: ProjectReplicaRpcResult[];
      };
      commit_ensemblis_project_mutation_v1: {
        Args: {
          p_workspace_id: string;
          p_project_id: string;
          p_actor_id: string;
          p_device_id: string;
          p_expected_revision: number;
          p_mutation_id: string;
          p_base_revision: number;
          p_operation: string;
          p_entity_id: string | null;
          p_target: string;
          p_payload: Json;
          p_created_at: string;
          p_next_manifest: Json;
        };
        Returns: ProjectReplicaRpcResult[];
      };
    };
  };
};
