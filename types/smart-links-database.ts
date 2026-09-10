import type { Json } from "@/types/database";

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type SmartLink = {
  id: string;
  owner_id: string;
  artist_id: string;
  site_id: string;
  release_id: string;
  slug: string;
  goal: "streams" | "saves" | "follows" | "discovery" | "community";
  fallback_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SmartLinkDestination = {
  id: string;
  smart_link_id: string;
  owner_id: string;
  artist_id: string;
  provider: string;
  label: string;
  destination_url: string;
  destination_kind: "streaming" | "pre_save" | "fallback";
  sort_order: number;
  is_active: boolean;
  source: "release" | "manual" | "provider";
  created_at: string;
  updated_at: string;
};

export type SmartLinkSource = {
  id: string;
  smart_link_id: string;
  owner_id: string;
  artist_id: string;
  campaign_id: string | null;
  content_item_id: string | null;
  moment_id: string | null;
  code: string;
  label: string | null;
  created_at: string;
};

export type SmartLinkEvent = {
  id: string;
  smart_link_id: string;
  destination_id: string | null;
  owner_id: string;
  artist_id: string;
  release_id: string;
  campaign_id: string | null;
  content_item_id: string | null;
  moment_id: string | null;
  source_code: string | null;
  event_type: "landing_view" | "outbound_click" | "pre_save_start" | "pre_save_completion";
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  referrer_host: string | null;
  verified: boolean;
  verification_reference: string | null;
  metadata: Json;
  occurred_at: string;
  created_at: string;
};

export type SmartLinkReadback = {
  smart_link_id: string;
  owner_id: string;
  artist_id: string;
  release_id: string;
  release_date: string | null;
  landing_views: number;
  outbound_clicks: number;
  pre_save_starts: number;
  verified_pre_save_completions: number;
  launch_actions_day_7: number;
  launch_actions_day_30: number;
  last_event_at: string | null;
};

export type SmartLinksDatabase = {
  public: {
    Tables: {
      smart_links: Table<SmartLink>;
      smart_link_destinations: Table<SmartLinkDestination>;
      smart_link_sources: Table<SmartLinkSource>;
      smart_link_events: Table<SmartLinkEvent>;
    };
    Views: {
      smart_link_readback: { Row: SmartLinkReadback; Relationships: [] };
    };
    Functions: {
      record_smart_link_event: {
        Args: {
          p_site_id: string;
          p_slug: string;
          p_event_type: string;
          p_destination_id?: string | null;
          p_source_code?: string | null;
          p_referrer_host?: string | null;
          p_utm_source?: string | null;
          p_utm_medium?: string | null;
          p_utm_campaign?: string | null;
          p_utm_content?: string | null;
        };
        Returns: Array<{ smart_link_id: string; release_id: string; destination_url: string | null; destination_kind: string | null }>;
      };
      record_verified_pre_save_completion: {
        Args: { p_destination_id: string; p_source_code: string; p_verification_reference: string; p_metadata?: Json };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
