import type { Database } from "./database";

export type ArtistAutonomyContractRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  domain: string;
  mode: string;
  enabled: boolean;
  max_single_spend_usd: number | null;
  max_total_spend_usd: number | null;
  allowed_providers: string[];
  allowed_platforms: string[];
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AutonomyDecisionEventRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  domain: string;
  contract_id: string | null;
  requested_action: string;
  resolved_behavior: string;
  reason: string;
  contract_snapshot: Record<string, unknown>;
  effect_snapshot: Record<string, unknown>;
  execution_id: string | null;
  created_at: string;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type AutonomyTables = {
  artist_autonomy_contracts: Table<
    ArtistAutonomyContractRow,
    Omit<ArtistAutonomyContractRow, "id" | "created_at" | "updated_at"> & {
      id?: string;
      created_at?: string;
      updated_at?: string;
    }
  >;
  autonomy_decision_events: Table<
    AutonomyDecisionEventRow,
    Omit<AutonomyDecisionEventRow, "id" | "created_at"> & {
      id?: string;
      created_at?: string;
    }
  >;
};

export type AutonomyContractsDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & AutonomyTables;
  };
};
