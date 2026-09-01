import type { MarketingDatabase } from "./marketing-database";
import type { Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MarketingMediaJob = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  release_id: string | null;
  content_item_id: string;
  generation_run_id: string | null;
  job_type: "finish_social_video";
  status: "planned" | "queued" | "running" | "completed" | "failed" | "cancelled";
  idempotency_key: string;
  request_payload: Json;
  result_payload: Json;
  external_job_id: string | null;
  attempt_count: number;
  max_attempts: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingMediaDatabase = Omit<MarketingDatabase, "public"> & {
  public: Omit<MarketingDatabase["public"], "Tables"> & {
    Tables: MarketingDatabase["public"]["Tables"] & {
      marketing_media_jobs: Table<MarketingMediaJob>;
    };
  };
};
