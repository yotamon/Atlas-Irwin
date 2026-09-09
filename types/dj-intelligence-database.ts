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
  openingEnergy: number;
  closingEnergy: number;
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

export type DjPreferenceEvidenceRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  automix_job_id: string;
  evidence_type: "plan_feedback";
  verdict: "accepted" | "rejected";
  signal: Json;
  created_at: string;
  updated_at: string;
};

type ExistingTables = Database["public"]["Tables"];

export type DjIntelligenceDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: ExistingTables & {
      dj_profiles: Table<DjProfileRow>;
      dj_preference_evidence: Table<DjPreferenceEvidenceRow>;
    };
  };
};
