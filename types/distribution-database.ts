import type { Database, Json } from "@/types/database";

export type DistributionAccount = {
  id: string;
  owner_id: string;
  provider: string;
  provider_account_id: string | null;
  status: "setup_required" | "pending_verification" | "active" | "restricted" | "suspended";
  legal_name: string | null;
  country_code: string | null;
  agreement_accepted_at: string | null;
  rights_terms_accepted_at: string | null;
  kyc_status: "not_started" | "pending" | "verified" | "failed";
  payout_status: "not_started" | "pending" | "ready" | "restricted";
  provider_metadata: Json;
  created_at: string;
  updated_at: string;
};

export type DistributionArtistProfile = {
  id: string;
  owner_id: string;
  artist_name: string;
  platform: string;
  external_artist_id: string | null;
  external_url: string | null;
  status: "unconfirmed" | "suggested" | "confirmed" | "create_new" | "conflict";
  confidence: number | null;
  provider_metadata: Json;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReleaseDistributionConfig = {
  release_id: string;
  owner_id: string;
  provider: string;
  provider_release_id: string | null;
  state: "draft" | "needs_attention" | "ready" | "submitted" | "under_review" | "approved" | "delivering" | "delivered" | "partially_live" | "live" | "rejected" | "update_pending" | "takedown_pending" | "taken_down" | "error";
  destinations: Json;
  territories: Json;
  rights: Json;
  ai_provenance: Json;
  provider_metadata: Json;
  readiness_score: number;
  last_validated_at: string | null;
  submitted_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DistributionSubmission = {
  id: string;
  owner_id: string;
  release_id: string;
  version: number;
  provider: string;
  provider_release_id: string;
  state: Exclude<ReleaseDistributionConfig["state"], "draft" | "needs_attention" | "ready">;
  metadata_snapshot: Json;
  rights_snapshot: Json;
  ai_provenance_snapshot: Json;
  asset_snapshot: Json;
  destination_snapshot: Json;
  provider_snapshot: Json;
  submitted_at: string;
  created_at: string;
};

export type DistributionDelivery = {
  id: string;
  owner_id: string;
  release_id: string;
  submission_id: string | null;
  provider: string;
  store_id: string;
  store_name: string;
  state: Exclude<ReleaseDistributionConfig["state"], "draft" | "needs_attention" | "ready">;
  provider_status: string | null;
  store_url: string | null;
  raw_status: Json;
  delivered_at: string | null;
  live_at: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

export type DistributionValidationIssue = {
  id: string;
  owner_id: string;
  release_id: string;
  submission_id: string | null;
  fingerprint: string;
  code: string;
  title: string;
  detail: string;
  severity: "error" | "warning" | "info";
  source: "ensemblis" | "provider" | "store";
  object_type: string | null;
  object_id: string | null;
  store_id: string | null;
  status: "open" | "acknowledged" | "resolved" | "ignored";
  raw_issue: Json;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DistributionEvent = {
  id: string;
  owner_id: string;
  release_id: string | null;
  submission_id: string | null;
  event_type: string;
  actor_type: "artist" | "operator" | "system" | "provider";
  provider: string | null;
  payload: Json;
  created_at: string;
};

export type DistributionTrackMetadata = {
  track_id: string;
  owner_id: string;
  metadata_language_code: string;
  audio_language_code: string;
  explicit: boolean;
  track_origin: "original" | "cover" | "public_domain";
  isrc: string | null;
  created_at: string;
  updated_at: string;
};

export type DistributionTrackWriter = {
  id: string;
  owner_id: string;
  track_id: string;
  legal_name: string;
  role: "composer" | "lyricist" | "composer_lyricist";
  share: number;
  publishing_type: "copyright_control" | "published" | "public_domain";
  publisher_name: string | null;
  created_at: string;
  updated_at: string;
};

export type DistributionTrackContributor = {
  id: string;
  owner_id: string;
  track_id: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
};

export type DistributionProviderOperation = {
  id: string;
  owner_id: string;
  release_id: string;
  provider: string;
  operation_type: "prepare_catalog" | "submit" | "update_catalog" | "takedown";
  operation_key: string;
  state: "started" | "completed" | "failed_safe" | "ambiguous" | "resolved";
  request_snapshot: Json;
  result_snapshot: Json;
  provider_resource_id: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type DistributionDatabase = {
  public: {
    Tables: Database["public"]["Tables"] & {
      distribution_accounts: Table<DistributionAccount>;
      distribution_artist_profiles: Table<DistributionArtistProfile>;
      release_distribution_configs: Table<ReleaseDistributionConfig>;
      distribution_submissions: Table<DistributionSubmission>;
      distribution_deliveries: Table<DistributionDelivery>;
      distribution_validation_issues: Table<DistributionValidationIssue>;
      distribution_events: Table<DistributionEvent>;
      distribution_track_metadata: Table<DistributionTrackMetadata>;
      distribution_track_writers: Table<DistributionTrackWriter>;
      distribution_track_contributors: Table<DistributionTrackContributor>;
      distribution_provider_operations: Table<DistributionProviderOperation>;
    };
    Views: Database["public"]["Views"];
    Functions: Database["public"]["Functions"] & {
      create_distribution_submission: {
        Args: {
          p_release_id: string;
          p_provider: string;
          p_provider_release_id: string;
          p_metadata_snapshot: Json;
          p_rights_snapshot: Json;
          p_ai_provenance_snapshot: Json;
          p_asset_snapshot: Json;
          p_destination_snapshot: Json;
          p_provider_snapshot?: Json;
        };
        Returns: string;
      };
    };
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
  private: Database["private"];
};
