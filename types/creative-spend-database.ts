import type { CreativeDerivativeDatabase } from "./creative-derivative-database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type CampaignAiSpendEnvelope = {
  id: string;
  owner_id: string;
  campaign_id: string;
  enabled: boolean;
  hard_limit_usd: number;
  max_single_generation_usd: number;
  allowed_media_kinds: Array<"image" | "video">;
  reserved_usd: number;
  spent_usd: number;
  overrun_usd: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignAiSpendReservation = {
  id: string;
  owner_id: string;
  campaign_id: string;
  envelope_id: string;
  generation_run_id: string;
  media_kind: "image" | "video";
  reserved_usd: number;
  settled_usd: number | null;
  settlement_basis: "provider_actual" | "estimated" | "conservative_reserve" | "not_billed" | null;
  status: "reserved" | "settled" | "released";
  released_reason: string | null;
  reserved_at: string;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreativeSpendDatabase = Omit<CreativeDerivativeDatabase, "public"> & {
  public: Omit<CreativeDerivativeDatabase["public"], "Tables" | "Functions"> & {
    Tables: CreativeDerivativeDatabase["public"]["Tables"] & {
      campaign_ai_spend_envelopes: Table<CampaignAiSpendEnvelope>;
      campaign_ai_spend_reservations: Table<CampaignAiSpendReservation>;
    };
    Functions: CreativeDerivativeDatabase["public"]["Functions"] & {
      reserve_campaign_ai_spend: {
        Args: {
          p_owner_id: string;
          p_campaign_id: string;
          p_generation_run_id: string;
          p_media_kind: "image" | "video";
          p_amount_usd: number;
        };
        Returns: CampaignAiSpendReservation;
      };
      settle_campaign_ai_spend: {
        Args: {
          p_owner_id: string;
          p_reservation_id: string;
          p_actual_usd: number | null;
          p_basis?: "provider_actual" | "estimated" | "conservative_reserve" | "not_billed";
        };
        Returns: CampaignAiSpendReservation;
      };
      release_campaign_ai_spend: {
        Args: {
          p_owner_id: string;
          p_reservation_id: string;
          p_reason?: string;
        };
        Returns: CampaignAiSpendReservation;
      };
    };
  };
};
