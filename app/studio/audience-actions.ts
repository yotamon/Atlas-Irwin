"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { sendAudienceReply, syncAudienceInteractions } from "@/lib/marketing/audience";
import { requireArtistContext } from "@/lib/studio/artist-context";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function syncAudienceNow() {
  const artist = await requireArtistContext();
  await syncAudienceInteractions({ ownerId: artist.userId, artistId: artist.artistId });
  revalidatePath("/studio/audience");
  revalidatePath("/studio");
}

export async function approveAudienceReply(form: FormData) {
  const artist = await requireArtistContext();
  const id = z.uuid().parse(value(form, "id"));
  const reply = z.string().trim().min(1).max(1000).parse(value(form, "reply"));
  await sendAudienceReply(artist.userId, artist.artistId, id, reply);
  revalidatePath("/studio/audience");
  revalidatePath("/studio");
}

export async function ignoreAudienceInteraction(form: FormData) {
  const artist = await requireArtistContext();
  const id = z.uuid().parse(value(form, "id"));
  const db = createAutonomyServiceClient();
  const { error } = await db.from("audience_interactions")
    .update({ status: "ignored", auto_reply_eligible: false })
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/audience");
  revalidatePath("/studio");
}
