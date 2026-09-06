import type { Database, Json } from "./database";

export type VisualBrandVersionRow = {
  id: string;
  owner_id: string;
  artist_id: string;
  version: number;
  status: "draft" | "active" | "archived";
  maturity: "starting" | "emerging" | "established";
  use_cases: string[];
  source_asset_ids: string[];
  canonical_asset_ids: string[];
  dna: Json;
  analysis: Json;
  confidence: number;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
};

type VisualBrandVersionInsert = {
  id?: string;
  owner_id: string;
  artist_id: string;
  version: number;
  status?: VisualBrandVersionRow["status"];
  maturity?: VisualBrandVersionRow["maturity"];
  use_cases?: string[];
  source_asset_ids?: string[];
  canonical_asset_ids?: string[];
  dna?: Json;
  analysis?: Json;
  confidence?: number;
  created_at?: string;
  updated_at?: string;
  activated_at?: string | null;
};

type VisualBrandVersionUpdate = Partial<Omit<VisualBrandVersionInsert, "owner_id" | "artist_id" | "version">> & {
  owner_id?: string;
  artist_id?: string;
  version?: number;
};

export type VisualBrandDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      artist_visual_brand_versions: {
        Row: VisualBrandVersionRow;
        Insert: VisualBrandVersionInsert;
        Update: VisualBrandVersionUpdate;
        Relationships: [];
      };
    };
  };
};
