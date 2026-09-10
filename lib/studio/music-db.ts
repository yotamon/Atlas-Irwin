import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtistContext } from "./artist-context";
import type { Database } from "@/types/database";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";

export function asArtistScopedMusicClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
}

export function scopeArtistQuery<
  T extends {
    eq(column: "artist_id", value: string): T;
  },
>(query: T, context: Pick<ArtistContext, "artistId">): T {
  return query.eq("artist_id", context.artistId);
}
