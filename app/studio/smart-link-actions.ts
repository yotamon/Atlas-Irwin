"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asSmartLinksClient } from "@/lib/smart-links/db";

const uuid = z.uuid();
const httpUrl = z.string().trim().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), "URL must use HTTP or HTTPS.");
const kindSchema = z.enum(["pre_save", "fallback"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function upsertSmartLinkDestinationAction(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = asSmartLinksClient(supabase);
  const smartLinkId = uuid.parse(value(form, "smartLinkId"));
  const destinationKind = kindSchema.parse(value(form, "destinationKind"));
  const provider = z.string().trim().min(1).max(80).parse(value(form, "provider"));
  const label = z.string().trim().min(1).max(120).parse(value(form, "label"));
  const destinationUrl = httpUrl.parse(value(form, "destinationUrl"));

  const { data: link, error: linkError } = await db.from("smart_links")
    .select("id,owner_id,artist_id,release_id")
    .eq("id", smartLinkId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (!link) throw new Error("Smart Link not found for the active artist.");

  const { error } = await db.from("smart_link_destinations").upsert({
    smart_link_id: link.id,
    owner_id: user.id,
    artist_id: artist.artistId,
    provider,
    label,
    destination_url: destinationUrl,
    destination_kind: destinationKind,
    sort_order: destinationKind === "pre_save" ? 5 : 90,
    is_active: true,
    source: "manual",
  }, { onConflict: "smart_link_id,provider,destination_kind" });
  if (error) throw new Error(error.message);

  revalidatePath("/studio/sites");
  revalidatePath(`/studio/releases/${link.release_id}`);
}

export async function setSmartLinkDestinationActiveAction(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = asSmartLinksClient(supabase);
  const destinationId = uuid.parse(value(form, "destinationId"));
  const active = value(form, "active") === "true";
  const { data, error } = await db.from("smart_link_destinations")
    .update({ is_active: active })
    .eq("id", destinationId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .select("smart_link_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Destination not found for the active artist.");
  revalidatePath("/studio/sites");
}
