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

type CanonicalArtistScopedTable<
  SourceTable,
  Row extends { artist_id: string },
> = Omit<SourceTable, "Row" | "Insert" | "Update"> & {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, "artist_id">;
  Update: Partial<Row>;
};

type CoreTables = CoreDatabase["public"]["Tables"];

type CanonicalMusicTables = Omit<CoreTables, "releases" | "tracks"> & {
  releases: CanonicalArtistScopedTable<CoreTables["releases"], Release>;
  tracks: CanonicalArtistScopedTable<CoreTables["tracks"], Track>;
};

export type Database = {
  public: {
    Tables: CanonicalMusicTables & EnsemblisDatabase["public"]["Tables"];
    Views: CoreDatabase["public"]["Views"] & EnsemblisDatabase["public"]["Views"];
    Functions: CoreDatabase["public"]["Functions"] & EnsemblisDatabase["public"]["Functions"];
    Enums: CoreDatabase["public"]["Enums"] & EnsemblisDatabase["public"]["Enums"];
    CompositeTypes: CoreDatabase["public"]["CompositeTypes"] & EnsemblisDatabase["public"]["CompositeTypes"];
  };
  private: CoreDatabase["private"];
};
