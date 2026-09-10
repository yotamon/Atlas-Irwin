import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MasteringPreset = "balanced" | "punchy" | "dynamic";
export type MasteringJobStatus = "planned" | "queued" | "running" | "completed" | "failed" | "cancelled";

export type TrackMasteringJob = {
  id: string;
  owner_id: string;
  artist_id: string;
  track_vault_id: string;
  preset: MasteringPreset;
  status: MasteringJobStatus;
  idempotency_key: string;
  source_audio_url: string;
  source_media_asset_id: string | null;
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

export type MasteringDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: ExistingTables & {
      track_mastering_jobs: Table<TrackMasteringJob>;
    };
  };
};
