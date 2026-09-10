"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import type { Json } from "@/types/database";

const required = z.string().trim().min(1).max(300);
const text = z.string().trim().max(10000);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function jsonText(input: string) {
  return { text: input } as Json;
}

async function context(form: FormData) {
  const requestedArtistId = value(form, "artist_id") || undefined;
  const artist = await requireArtistContext(requestedArtistId);
  const { supabase } = await requireStudioAdmin();
  return { artist, operational: asArtistScopedOperationalClient(supabase) };
}

export async function saveArtistBrandSetting(form: FormData) {
  const { artist, operational } = await context(form);
  const section = required.parse(value(form, "section"));
  const content = jsonText(text.parse(value(form, "content")));
  const { data: existing, error: lookupError } = await operational.from("brand_settings")
    .select("id")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .eq("section", section)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  const mutation = existing
    ? operational.from("brand_settings")
        .update({ content })
        .eq("id", existing.id)
        .eq("owner_id", artist.userId)
        .eq("artist_id", artist.artistId)
    : operational.from("brand_settings").insert({
        owner_id: artist.userId,
        artist_id: artist.artistId,
        section,
        content,
      });
  const { error } = await mutation;
  if (error) throw new Error(error.message);
  revalidatePath("/studio/brand");
  revalidatePath("/studio/settings/brand");
}

export async function deleteArtistBrandSetting(form: FormData) {
  const { artist, operational } = await context(form);
  const id = z.uuid().parse(value(form, "id"));
  const { error } = await operational.from("brand_settings")
    .delete()
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/brand");
  revalidatePath("/studio/settings/brand");
}
