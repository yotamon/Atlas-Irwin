import type { MarketingMediaDatabase } from "./marketing-media-database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type CreativeDerivative = {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  master_content_item_id: string;
  derivative_content_item_id: string;
  master_generation_run_id: string;
  derivative_generation_run_id: string | null;
  target_platform: string;
  target_format: string;
  target_package_id: string;
  strategy: "reuse_approved_image" | "deterministic_video_repackage";
  auto_approve: boolean;
  status: "planned" | "processing" | "ready" | "failed" | "cancelled";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeDerivativeDatabase = Omit<MarketingMediaDatabase, "public"> & {
  public: Omit<MarketingMediaDatabase["public"], "Tables"> & {
    Tables: MarketingMediaDatabase["public"]["Tables"] & {
      creative_derivatives: Table<CreativeDerivative>;
    };
  };
};
