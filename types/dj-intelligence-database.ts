import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type DjPreferenceValues = {
  enabled: boolean;
  harmonicAdventure: number;
  transitionAggressiveness: number;
  exploration: number;
  tempoMovement: number;
  energyDynamics: number;
};

export type DjProfileRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  explicit_preferences: Json;
  learned_preferences: Json;
  learned_confidence: number;
  evidence_count: number;
  profile_version: number;
  created_at: string;
  updated_at: string;
};

export type DjEvidenceType = "plan_feedback" | "plan_edit" | "plan_approval";
export type DjLibraryHistorySourceKind = "rekordbox" | "serato" | "traktor" | "local_library";

export type DjPreferenceEvidenceRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  automix_job_id: string;
  evidence_type: DjEvidenceType;
  evidence_key: string;
  verdict: "accepted" | "rejected";
  signal: Json;
  weight: number;
  created_at: string;
  updated_at: string;
};

export type DjLibraryHistoryEvidenceRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  source_kind: DjLibraryHistorySourceKind;
  source_id: string;
  source_revision: string;
  evidence_key: string;
  signal: Json;
  weight: number;
  sample_count: number;
  created_at: string;
  updated_at: string;
};

type ExistingTables = Database["public"]["Tables"];

export type DjIntelligenceDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: ExistingTables & {
      dj_profiles: Table<DjProfileRow>;
      dj_preference_evidence: Table<DjPreferenceEvidenceRow>;
      dj_library_history_evidence: Table<DjLibraryHistoryEvidenceRow>;
    };
  };
};
