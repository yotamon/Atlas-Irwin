"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { refreshNextBestActions } from "@/lib/marketing/next-best-action";
import { refreshMarketingRadarIfDue } from "@/lib/marketing/radar";
import { requireArtistContext } from "@/lib/studio/artist-context";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function refreshAutopilot() {
  const artist = await requireArtistContext();
  const scope = { ownerId: artist.userId, artistId: artist.artistId };
  await refreshMarketingRadarIfDue(scope);
  await refreshNextBestActions(scope);
  revalidatePath("/studio/autopilot");
  revalidatePath("/studio");
}

export async function dismissNextBestAction(form: FormData) {
  const artist = await requireArtistContext();
  const id = z.uuid().parse(value(form, "id"));
  const db = createAutonomyServiceClient();
  const { error } = await db.from("next_best_actions")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/autopilot");
  revalidatePath("/studio");
}

export async function dismissMarketingOpportunity(form: FormData) {
  const artist = await requireArtistContext();
  const id = z.uuid().parse(value(form, "id"));
  const db = createAutonomyServiceClient();
  const { error } = await db.from("marketing_opportunities")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/autopilot");
  revalidatePath("/studio");
}
