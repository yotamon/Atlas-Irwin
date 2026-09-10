import type { Database, Json } from "./database";

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export const CREATIVE_MEMORY_EVENT_TYPES = [
  "direction_selected",
  "direction_rejected",
  "reference_approved",
  "reference_rejected",
  "shot_locked",
  "shot_rejected",
  "shot_replaced",
  "asset_used",
  "asset_exported",
  "performance_observed",
  "preference_signal",
  "exclusion_added",
  "exclusion_removed",
] as const;

export type CreativeMemoryEventType = (typeof CREATIVE_MEMORY_EVENT_TYPES)[number];

export type CreativeMemoryEvent = {
  id: string;
  owner_id: string;
  artist_id: string;
  asset_id: string | null;
  release_id: string | null;
  track_id: string | null;
  moment_id: string | null;
  video_project_id: string | null;
  event_type: CreativeMemoryEventType;
  sentiment: -1 | 0 | 1;
  weight: number;
  signal: string | null;
  source: string;
  idempotency_key: string;
  context: Json;
  created_at: string;
};

export type CreativeAssetProfile = {
  owner_id: string;
  artist_id: string;
  asset_id: string;
  visual_descriptors: string[];
  semantic_descriptors: string[];
  brand_relevance: number;
  excluded: boolean;
  exclusion_reason: string | null;
  duplicate_of_asset_id: string | null;
  duplicate_evidence: Json;
  evidence: Json;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeMemoryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      creative_memory_events: Table<CreativeMemoryEvent>;
      creative_asset_profiles: Table<CreativeAssetProfile>;
    };
  };
};
