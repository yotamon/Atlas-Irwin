import type { Json } from "@/types/database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type GrowthSettings = {
  owner_id: string;
  north_star: string;
  planning_horizon_days: number;
  release_cadence_days: number;
  minimum_candidate_score: number;
  catalog_engine_enabled: boolean;
  autoplan_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type VaultTrackStatus =
  | "idea"
  | "demo"
  | "mix"
  | "mastered"
  | "release_candidate"
  | "scheduled"
  | "released"
  | "hold"
  | "archived";

export type VaultTrack = {
  id: string;
  owner_id: string;
  linked_release_id: string | null;
  media_asset_id: string | null;
  title: string;
  version: string | null;
  status: VaultTrackStatus;
  audio_url: string | null;
  duration_seconds: number | null;
  notes: string | null;
  source: "manual" | "backfill" | "import" | "generator";
  artist_rating: number | null;
  hook_strength: number;
  short_form_potential: number;
  visual_potential: number;
  uniqueness_score: number;
  release_readiness: number;
  hook_start_seconds: number | null;
  hook_end_seconds: number | null;
  hold_until: string | null;
  analysis_confidence: number;
  audio_profile: Json;
  analysis: Json;
  created_at: string;
  updated_at: string;
};

export type GrowthPlanStatus = "proposed" | "accepted" | "scheduled" | "completed" | "skipped";

export type GrowthPlanItem = {
  id: string;
  owner_id: string;
  track_vault_id: string | null;
  release_id: string | null;
  target_date: string;
  sort_order: number;
  candidate_score: number;
  rationale: string;
  status: GrowthPlanStatus;
  source: "decision_engine" | "manual";
  created_at: string;
  updated_at: string;
};

export type GrowthOpportunityKind =
  | "catalog_revival"
  | "content_breakout"
  | "release_risk"
  | "funnel_bottleneck"
  | "release_candidate";

export type GrowthOpportunity = {
  id: string;
  owner_id: string;
  kind: GrowthOpportunityKind;
  release_id: string | null;
  track_vault_id: string | null;
  content_item_id: string | null;
  title: string;
  rationale: string;
  priority: number;
  confidence: number;
  evidence: Json;
  recommended_action: Json;
  dedupe_key: string;
  status: "new" | "accepted" | "dismissed" | "completed" | "expired";
  detected_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GrowthDatabase = {
  public: {
    Tables: {
      artist_growth_settings: Table<GrowthSettings>;
      track_vault: Table<VaultTrack>;
      growth_plan_items: Table<GrowthPlanItem>;
      growth_opportunities: Table<GrowthOpportunity>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
