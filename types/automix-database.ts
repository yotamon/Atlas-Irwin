import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type AutoMixPurpose = "booking" | "soundcloud" | "journey" | "peak_time" | "warm_up" | "discovery";
export type AutoMixEnergyProfile = "smooth" | "dynamic" | "peak";
export type AutoMixTransitionStyle = "clean" | "dj" | "creative";
export type AutoMixOutputFormat = "mp3" | "wav";
export type AutoMixJobStatus = "planned" | "queued" | "running" | "completed" | "failed" | "cancelled";

export type AutoMixJob = {
  id: string;
  owner_id: string;
  name: string;
  purpose: AutoMixPurpose;
  energy_profile: AutoMixEnergyProfile;
  transition_style: AutoMixTransitionStyle;
  output_format: AutoMixOutputFormat;
  target_duration_ms: number;
  track_ids: string[];
  source_fingerprints: Json;
  status: AutoMixJobStatus;
  idempotency_key: string;
  output_bucket: string;
  output_path: string;
  output_asset_id: string | null;
  request_payload: Json;
  result_payload: Json;
  external_job_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExistingTables = Database["public"]["Tables"];

export type AutoMixDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: ExistingTables & {
      automix_jobs: Table<AutoMixJob>;
    };
  };
};
