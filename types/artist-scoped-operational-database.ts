import type { AutonomyDatabase } from "./autonomy-database";
import type { GrowthDatabase } from "./growth-database";
import type { MarketingDatabase } from "./marketing-database";
import type { SocialDatabase } from "./social-database";

type ArtistScopedTable<T> = T extends {
  Row: infer Row;
  Insert: infer Insert;
  Update: infer Update;
  Relationships: infer Relationships;
}
  ? {
      Row: Row & { artist_id: string };
      Insert: Insert & { artist_id?: string };
      Update: Update & { artist_id?: string };
      Relationships: Relationships;
    }
  : T;

type ScopeTables<Tables, Names extends PropertyKey> = {
  [Key in keyof Tables]: Key extends Names ? ArtistScopedTable<Tables[Key]> : Tables[Key];
};

type MarketingScopedTableName =
  | "campaigns"
  | "campaign_phases"
  | "campaign_experiments"
  | "generation_runs"
  | "content_items"
  | "content_variants"
  | "publication_jobs"
  | "attribution_links"
  | "attribution_events"
  | "marketing_events"
  | "automation_jobs"
  | "marketing_learnings"
  | "metric_snapshots"
  | "outreach_sequences"
  | "outreach_sequence_steps"
  | "outreach_enrollments"
  | "outreach_messages";

export type ArtistScopedMarketingDatabase = Omit<MarketingDatabase, "public"> & {
  public: Omit<MarketingDatabase["public"], "Tables"> & {
    Tables: ScopeTables<MarketingDatabase["public"]["Tables"], MarketingScopedTableName>;
  };
};

export type ArtistScopedGrowthDatabase = Omit<GrowthDatabase, "public"> & {
  public: Omit<GrowthDatabase["public"], "Tables"> & {
    Tables: ScopeTables<
      GrowthDatabase["public"]["Tables"],
      "artist_growth_settings" | "track_vault" | "growth_plan_items" | "growth_opportunities"
    >;
  };
};

type SocialTokenRow = {
  access_token: string;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
};

export type ArtistScopedSocialDatabase = Omit<SocialDatabase, "public" | "private"> & {
  public: Omit<SocialDatabase["public"], "Tables" | "Functions"> & {
    Tables: ScopeTables<SocialDatabase["public"]["Tables"], "social_channel_accounts">;
    Functions: SocialDatabase["public"]["Functions"] & {
      get_social_channel_token_for_artist: {
        Args: { p_owner_id: string; p_artist_id: string; p_platform: string };
        Returns: SocialTokenRow[];
      };
      upsert_social_channel_token_for_artist: {
        Args: {
          p_owner_id: string;
          p_artist_id: string;
          p_platform: string;
          p_access_token: string;
          p_refresh_token: string | null;
          p_scope: string | null;
          p_expires_at: string | null;
          p_refresh_expires_at: string | null;
        };
        Returns: undefined;
      };
      delete_social_channel_token_for_artist: {
        Args: { p_owner_id: string; p_artist_id: string; p_platform: string };
        Returns: undefined;
      };
    };
  };
  private: Omit<SocialDatabase["private"], "Tables"> & {
    Tables: ScopeTables<SocialDatabase["private"]["Tables"], "social_channel_tokens">;
  };
};

export type ArtistScopedAutonomyDatabase = Omit<AutonomyDatabase, "public"> & {
  public: Omit<AutonomyDatabase["public"], "Tables"> & {
    Tables: ScopeTables<
      AutonomyDatabase["public"]["Tables"],
      "audience_interactions" | "marketing_opportunities" | "next_best_actions"
    >;
  };
};
