"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";

const uuid = z.uuid();
const reviewStatus = z.enum(["approved", "rejected"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function reviewLearning(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, uuid.parse(requestedArtistId))
    : await resolveDefaultArtistContext(supabase, user);
  const learningId = uuid.parse(value(form, "learning_id"));
  const status = reviewStatus.parse(value(form, "status"));
  const marketing = asMarketingClient(supabase);

  const { data: learning, error: lookupError } = await marketing
    .from("marketing_learnings")
    .select("id,campaign_id,status")
    .eq("id", learningId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .single();
  if (lookupError) throw new Error(lookupError.message);
  if (learning.status !== "proposed") {
    throw new Error("Only a current learning proposal can be reviewed.");
  }

  const { error } = await marketing
    .from("marketing_learnings")
    .update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", learningId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("status", "proposed");
  if (error) throw new Error(error.message);

  revalidatePath("/studio/learn");
  revalidatePath("/studio/create");
  revalidatePath("/studio/campaigns");
  revalidatePath("/studio/today");
  if (learning.campaign_id) revalidatePath(`/studio/campaigns/${learning.campaign_id}`);
}
