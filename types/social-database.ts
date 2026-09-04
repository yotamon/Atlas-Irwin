import type { Json } from "@/types/database";

export type SocialChannelAccount = {
  owner_id: string;
  artist_id: string;
  platform: "instagram" | "tiktok" | "youtube";
  external_account_id: string;
  display_name: string | null;
  username: string | null;
  profile_url: string | null;
  image_url: string | null;
  status: "connected" | "needs_reauth" | "error";
  granted_scopes: string[];
  can_publish: boolean;
  raw_profile: Json;
  connected_at: string;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
};

export type SocialChannelToken = {
  owner_id: string;
  artist_id: string;
  platform: "instagram" | "tiktok" | "youtube";
  access_token: string;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type SocialDatabase = {
  public: {
    Tables: {
      social_channel_accounts: Table<SocialChannelAccount>;
    };
    Views: Record<string, never>;
    Functions: {
      get_social_channel_token: {
        Args: { p_owner_id: string; p_artist_id: string; p_platform: string };
        Returns: Array<{
          access_token: string;
          refresh_token: string | null;
          scope: string | null;
          expires_at: string | null;
          refresh_expires_at: string | null;
        }>;
      };
      upsert_social_channel_token: {
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
      delete_social_channel_token: {
        Args: { p_owner_id: string; p_artist_id: string; p_platform: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  private: {
    Tables: {
      social_channel_tokens: Table<SocialChannelToken>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
