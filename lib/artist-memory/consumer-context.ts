import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { artistMemoryBrief, loadArtistMemoryForConsumer } from "./server";
import type { ArtistMemoryConsumer, ArtistMemoryEffect, ArtistMemoryItem } from "./domain";

export type BoundedArtistMemoryContext = {
  consumer: ArtistMemoryConsumer;
  maxEffect: ArtistMemoryEffect;
  brief: string;
  items: ArtistMemoryItem[];
};

export async function loadBoundedArtistMemoryContext(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  consumer: ArtistMemoryConsumer;
  maxCharacters?: number;
}): Promise<BoundedArtistMemoryContext | null> {
  try {
    const snapshot = await loadArtistMemoryForConsumer({
      db: input.db,
      ownerId: input.ownerId,
      artistId: input.artistId,
      consumer: input.consumer,
    });
    if (!snapshot.items.length) return null;
    return {
      consumer: input.consumer,
      maxEffect: snapshot.maxEffect,
      brief: artistMemoryBrief(snapshot.items, input.maxCharacters ?? 1_800),
      items: snapshot.items,
    };
  } catch {
    // Artist Memory enriches a workflow but must never become a new availability
    // dependency for deterministic analysis, planning, or artist decisions.
    return null;
  }
}
