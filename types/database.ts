export * from "./database-core";
export * from "./ensemblis-database";

import type {
  Database as CoreDatabase,
  Release as CoreRelease,
  Track as CoreTrack,
} from "./database-core";
import type { EnsemblisDatabase } from "./ensemblis-database";

type LegacyReleaseColumn =
  | "artist"
  | "artwork_url"
  | "cover_asset"
  | "cover_alt"
  | "canvas_video_url"
  | "public_release_path"
  | "spotify_url"
  | "apple_music_url"
  | "soundcloud_url"
  | "youtube_url"
  | "bandcamp_url"
  | "smart_link_url";

type LegacyTrackColumn = "audio_url" | "spotify_url" | "soundcloud_url";

export type Release = Omit<CoreRelease, LegacyReleaseColumn>;
export type Track = Omit<CoreTrack, LegacyTrackColumn>;

export type ReleaseReadModel = Release & {
  artist_name: string;
  cover_asset_id: string | null;
  cover_url: string | null;
  cover_alt: string | null;
  spotify_url: string | null;
  apple_music_url: string | null;
  soundcloud_url: string | null;
  youtube_url: string | null;
  bandcamp_url: string | null;
  smart_link_slug: string | null;
  smart_link_site_id: string | null;
};

export type TrackReadModel = Track & {
  master_audio_asset_id: string | null;
  master_audio_url: string | null;
  master_audio_bucket_name: string | null;
  master_audio_storage_path: string | null;
  spotify_url: string | null;
  soundcloud_url: string | null;
  youtube_url: string | null;
  apple_music_url: string | null;
};

type CanonicalArtistScopedTable<
  SourceTable,
  Row extends { artist_id: string },
> = Omit<SourceTable, "Row" | "Insert" | "Update"> & {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, "artist_id">;
  Update: Partial<Row>;
};

type ReadView<Row> = {
  Row: Row;
  Relationships: [];
};

type CoreTables = CoreDatabase["public"]["Tables"];

type CanonicalMusicTables = Omit<CoreTables, "releases" | "tracks"> & {
  releases: CanonicalArtistScopedTable<CoreTables["releases"], Release>;
  tracks: CanonicalArtistScopedTable<CoreTables["tracks"], Track>;
};

export type Database = {
  public: {
    Tables: CanonicalMusicTables & EnsemblisDatabase["public"]["Tables"];
    Views: CoreDatabase["public"]["Views"] & EnsemblisDatabase["public"]["Views"] & {
      release_read_model: ReadView<ReleaseReadModel>;
      track_read_model: ReadView<TrackReadModel>;
    };
    Functions: CoreDatabase["public"]["Functions"] & EnsemblisDatabase["public"]["Functions"];
    Enums: CoreDatabase["public"]["Enums"] & EnsemblisDatabase["public"]["Enums"];
    CompositeTypes: CoreDatabase["public"]["CompositeTypes"] & EnsemblisDatabase["public"]["CompositeTypes"];
  };
  private: CoreDatabase["private"];
};