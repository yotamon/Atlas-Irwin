export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Release = {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  release_type: string;
  status: string;
  release_date: string | null;
  story: string | null;
  core_emotion: string | null;
  audience: string | null;
  primary_hook: string | null;
  visual_direction: string | null;
  color_palette: string[];
  notes: string | null;
  spotify_url: string | null;
  soundcloud_url: string | null;
  youtube_url: string | null;
  smart_link_url: string | null;
  artwork_url: string | null;
  cover_asset: string | null;
  public_slug: string | null;
  public_release_path: string | null;
  story_answers: Json;
  release_identity: Json;
  readiness: Json;
  created_at: string;
  updated_at: string;
};

export type Track = {
  id: string;
  release_id: string;
  owner_id: string;
  title: string;
  version: string | null;
  duration: number | null;
  audio_url: string | null;
  soundcloud_url: string | null;
  spotify_url: string | null;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type ContentItem = {
  id: string;
  owner_id: string;
  release_id: string | null;
  title: string;
  platform: string;
  format: string;
  status: string;
  goal: string;
  scheduled_at: string | null;
  published_at: string | null;
  audio_timestamp_start: number | null;
  audio_timestamp_end: number | null;
  hook_text: string | null;
  caption: string | null;
  cta: string | null;
  visual_prompt: string | null;
  production_notes: string | null;
  asset_url: string | null;
  performance_notes: string | null;
  created_at: string;
  updated_at: string;
};
export type OutreachContact = {
  id: string;
  owner_id: string;
  name: string;
  platform: string | null;
  handle_or_url: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  contact_type: string;
  genres: string[];
  audience_size: number | null;
  contact_method: string | null;
  relationship_status: string;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};
export type OutreachMessage = {
  id: string;
  owner_id: string;
  contact_id: string;
  release_id: string | null;
  channel: string;
  message: string;
  sent_at: string | null;
  follow_up_at: string | null;
  response_status: string | null;
  response_notes: string | null;
  created_at: string;
  updated_at: string;
};
export type MetricSnapshot = {
  id: string;
  owner_id: string;
  date: string;
  platform: string;
  release_id: string | null;
  content_item_id: string | null;
  reach: number;
  views: number;
  watch_time: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profile_visits: number;
  follows: number;
  link_clicks: number;
  streams: number;
  listeners: number;
  playlist_adds: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type BrandSetting = {
  id: string;
  owner_id: string;
  section: string;
  content: Json;
  created_at: string;
  updated_at: string;
};
export type SoundCloudAccount = {
  owner_id: string;
  soundcloud_user_id: string;
  username: string;
  permalink_url: string | null;
  avatar_url: string | null;
  raw_profile: Json;
  connected_at: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};
export type SoundCloudToken = {
  owner_id: string;
  access_token: string;
  refresh_token: string;
  scope: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};
export type SoundCloudTrack = {
  id: string;
  owner_id: string;
  soundcloud_id: number;
  title: string;
  description: string | null;
  genre: string | null;
  permalink_url: string;
  artwork_url: string | null;
  duration: number | null;
  playback_count: number;
  favoritings_count: number;
  comment_count: number;
  reposts_count: number;
  streamable: boolean;
  downloadable: boolean;
  sharing: string | null;
  raw_track: Json;
  synced_at: string;
  created_at: string;
  updated_at: string;
};
export type SoundCloudPlaylist = {
  id: string;
  owner_id: string;
  soundcloud_id: number;
  title: string;
  description: string | null;
  genre: string | null;
  permalink_url: string;
  artwork_url: string | null;
  duration: number | null;
  track_count: number;
  raw_playlist: Json;
  synced_at: string;
  created_at: string;
  updated_at: string;
};
export type Task = {
  id: string;
  owner_id: string;
  release_id: string | null;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
export type Database = {
  public: {
    Tables: {
      releases: Table<Release>;
      tracks: Table<Track>;
      content_items: Table<ContentItem>;
      outreach_contacts: Table<OutreachContact>;
      outreach_messages: Table<OutreachMessage>;
      metric_snapshots: Table<MetricSnapshot>;
      brand_settings: Table<BrandSetting>;
      soundcloud_accounts: Table<SoundCloudAccount>;
      soundcloud_tracks: Table<SoundCloudTrack>;
      soundcloud_playlists: Table<SoundCloudPlaylist>;
      tasks: Table<Task>;
      release_learnings: Table<{
        id: string;
        owner_id: string;
        release_id: string;
        learning: string;
        created_at: string;
        updated_at: string;
      }>;
      content_assets: Table<{
        id: string;
        owner_id: string;
        content_item_id: string | null;
        release_id: string | null;
        storage_path: string;
        mime_type: string | null;
        created_at: string;
        updated_at: string;
      }>;
      profiles: Table<{
        id: string;
        email: string;
        is_admin: boolean;
        created_at: string;
        updated_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      delete_soundcloud_token: {
        Args: { p_owner_id: string };
        Returns: undefined;
      };
      get_soundcloud_token: {
        Args: { p_owner_id: string };
        Returns: {
          access_token: string;
          refresh_token: string;
          scope: string | null;
          expires_at: string;
        }[];
      };
      is_studio_admin: { Args: Record<string, never>; Returns: boolean };
      upsert_soundcloud_token: {
        Args: {
          p_access_token: string;
          p_expires_at: string;
          p_owner_id: string;
          p_refresh_token: string;
          p_scope: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  private: {
    Tables: {
      soundcloud_tokens: Table<SoundCloudToken>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
