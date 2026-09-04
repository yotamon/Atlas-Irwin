import type { MarketingContentItem } from "@/types/marketing-database";
import type { ArtistScopedMarketingDatabase } from "@/types/artist-scoped-operational-database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MomentAwareContentItem = MarketingContentItem & {
  artist_id: string;
  moment_id: string | null;
};

export type CampaignMoment = {
  id: string;
  owner_id: string;
  artist_id: string;
  campaign_id: string;
  moment_id: string;
  role: "primary" | "supporting" | "experiment";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MomentAwareMarketingDatabase = Omit<ArtistScopedMarketingDatabase, "public"> & {
  public: Omit<ArtistScopedMarketingDatabase["public"], "Tables"> & {
    Tables: Omit<ArtistScopedMarketingDatabase["public"]["Tables"], "content_items"> & {
      content_items: Table<MomentAwareContentItem>;
      campaign_moments: Table<CampaignMoment>;
    };
  };
};
