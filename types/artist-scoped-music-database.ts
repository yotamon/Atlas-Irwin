import type {
  Database,
  HomepagePlacement,
  Release,
  ReleaseExternalLink,
  Track,
  TrackExternalId,
} from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type ArtistScoped<Row> = Row & { artist_id: string };
type ExistingTables = Database["public"]["Tables"];

export type ArtistScopedRelease = ArtistScoped<Release>;
export type ArtistScopedTrack = ArtistScoped<Track>;
export type ArtistScopedHomepagePlacement = ArtistScoped<HomepagePlacement>;
export type ArtistScopedTrackExternalId = ArtistScoped<TrackExternalId>;
export type ArtistScopedReleaseExternalLink = ArtistScoped<ReleaseExternalLink>;

export type ArtistScopedMusicDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<
      ExistingTables,
      | "releases"
      | "tracks"
      | "homepage_placements"
      | "track_external_ids"
      | "release_external_links"
    > & {
      releases: Table<ArtistScopedRelease>;
      tracks: Table<ArtistScopedTrack>;
      homepage_placements: Table<ArtistScopedHomepagePlacement>;
      track_external_ids: Table<ArtistScopedTrackExternalId>;
      release_external_links: Table<ArtistScopedReleaseExternalLink>;
    };
  };
};
