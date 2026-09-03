import type { MarketingContentItem, MarketingDatabase } from "@/types/marketing-database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MomentAwareContentItem = MarketingContentItem & {
  moment_id: string | null;
};

export type CampaignMoment = {
  id: string;
  owner_id: string;
  campaign_id: string;
  moment_id: string;
  role: "primary" | "supporting" | "experiment";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MomentAwareMarketingDatabase = Omit<MarketingDatabase, "public"> & {
  public: Omit<MarketingDatabase["public"], "Tables"> & {
    Tables: Omit<MarketingDatabase["public"]["Tables"], "content_items"> & {
      content_items: Table<MomentAwareContentItem>;
      campaign_moments: Table<CampaignMoment>;
    };
  };
};
