import "server-only";

import type { ArtistContext } from "./artist-context";

export function scopeArtistQuery<
  T extends {
    eq(column: "artist_id", value: string): T;
  },
>(query: T, context: Pick<ArtistContext, "artistId">): T {
  return query.eq("artist_id", context.artistId);
}
