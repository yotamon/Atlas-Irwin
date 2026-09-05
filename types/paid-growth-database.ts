import type { Database, Json } from "@/types/database";

export type PaidGrowthState = "draft" | "ready_for_approval" | "approved" | "launching" | "running" | "paused" | "evaluating" | "completed" | "stopped" | "error";
export type PaidGrowthApprovalStatus = "pending" | "approved" | "rejected" | "revoked";
export type PaidGrowthSuccessMetric = "landing_views" | "outbound_clicks" | "pre_save_completions" | "cost_per_outbound_click" | "cost_per_pre_save_completion";

export type PaidGrowthExperiment = {
  id: string;
  owner_id: string;
  artist_id: string;
  release_id: string;
  campaign_id: string | null;
  moment_id: string | null;
  content_item_id: string | null;
  smart_link_id: string;
  smart_link_source_id: string | null;
  title: string;
  hypothesis: string;
  evidence: Json;
  evidence_strength: "preliminary" | "supported" | "strong";
  provider: string;
  platform: "instagram" | "facebook" | "tiktok" | "youtube" | "other";
  objective: "discovery" | "traffic" | "pre_save" | "streams";
  audience: Json;
  geo_countries: string[];
  currency: "USD";
  budget_ceiling_cents: number;
  daily_budget_cents: number | null;
  spent_cents: number;
  minimum_sample: number;
  success_metric: PaidGrowthSuccessMetric;
  success_threshold: number;
  stop_conditions: Json;
  state: PaidGrowthState;
  approval_status: PaidGrowthApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  provider_experiment_id: string | null;
  provider_metadata: Json;
  starts_at: string | null;
  ends_at: string | null;
  verified_outcome: boolean;
  result_summary: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type PaidGrowthObservation = {
  id: string;
  experiment_id: string;
  owner_id: string;
  artist_id: string;
  provider: string;
  provider_reference: string | null;
  impressions: number;
  provider_clicks: number;
  spend_cents: number;
  landing_views: number;
  outbound_clicks: number;
  pre_save_completions: number;
  verified: boolean;
  verification_reference: string | null;
  provider_snapshot: Json;
  first_party_snapshot: Json;
  observed_at: string;
  created_at: string;
};

export type PaidGrowthOperation = {
  id: string;
  experiment_id: string;
  owner_id: string;
  artist_id: string;
  provider: string;
  operation_type: "launch" | "pause" | "resume" | "stop" | "sync";
  operation_key: string;
  state: "started" | "completed" | "failed_safe" | "ambiguous" | "resolved";
  request_snapshot: Json;
  result_snapshot: Json;
  provider_resource_id: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export type PaidGrowthEvent = {
  id: string;
  experiment_id: string;
  owner_id: string;
  artist_id: string;
  event_type: string;
  actor_type: "artist" | "system" | "provider";
  payload: Json;
  created_at: string;
};

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type ArtistScopedRelease = Database["public"]["Tables"]["releases"]["Row"] & { artist_id: string };
type PaidMoment = { id: string; owner_id: string; artist_id: string; release_id: string; label: string; state: string; start_ms: number; end_ms: number };
type PaidContentItem = { id: string; owner_id: string; artist_id: string; release_id: string | null; title: string; asset_url: string | null; status: string; platform: string };
type PaidSmartLink = { id: string; owner_id: string; artist_id: string; release_id: string; slug: string; goal: string; is_active: boolean; site_id: string };
type PaidSmartLinkSource = { id: string; smart_link_id: string; owner_id: string; artist_id: string; campaign_id: string | null; content_item_id: string | null; moment_id: string | null; code: string; label: string | null };
type PaidSmartLinkEvent = { id: string; smart_link_id: string; owner_id: string; artist_id: string; release_id: string; campaign_id: string | null; content_item_id: string | null; moment_id: string | null; source_code: string | null; event_type: "landing_view" | "outbound_click" | "pre_save_start" | "pre_save_completion"; verified: boolean; verification_reference: string | null; occurred_at: string };

export type PaidGrowthDatabase = {
  public: {
    Tables: Omit<Database["public"]["Tables"], "releases" | "content_items"> & {
      releases: Table<ArtistScopedRelease>;
      moments: Table<PaidMoment>;
      content_items: Table<PaidContentItem>;
      smart_links: Table<PaidSmartLink>;
      smart_link_sources: Table<PaidSmartLinkSource>;
      smart_link_events: Table<PaidSmartLinkEvent>;
      paid_growth_experiments: Table<PaidGrowthExperiment>;
      paid_growth_observations: Table<PaidGrowthObservation>;
      paid_growth_operations: Table<PaidGrowthOperation>;
      paid_growth_events: Table<PaidGrowthEvent>;
    };
    Views: Database["public"]["Views"];
    Functions: Database["public"]["Functions"] & {
      record_paid_growth_observation: {
        Args: {
          p_experiment_id: string;
          p_provider_reference: string | null;
          p_impressions: number;
          p_provider_clicks: number;
          p_spend_cents: number;
          p_landing_views: number;
          p_outbound_clicks: number;
          p_pre_save_completions: number;
          p_verified: boolean;
          p_verification_reference: string | null;
          p_provider_snapshot: Json;
          p_first_party_snapshot: Json;
          p_observed_at: string;
        };
        Returns: string;
      };
    };
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
  private: Database["private"];
};
