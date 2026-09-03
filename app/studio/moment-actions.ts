"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asMomentsClient } from "@/lib/studio/moments-db";

const uuid = z.uuid();
const seconds = z.coerce.number().finite().nonnegative().max(60 * 60 * 6);
const labelSchema = z.string().trim().min(1).max(180);
const decisionSchema = z.enum(["save", "approve", "reject"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function reviewMoment(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const moments = asMomentsClient(supabase);
  const momentId = uuid.parse(value(form, "moment_id"));
  const releaseId = uuid.parse(value(form, "release_id"));
  const decision = decisionSchema.parse(value(form, "decision"));

  const { data: moment, error: lookupError } = await moments
    .from("moments")
    .select("id,release_id,artist_id,state,start_ms,end_ms")
    .eq("id", momentId)
    .eq("release_id", releaseId)
    .eq("artist_id", artist.artistId)
    .single();
  if (lookupError || !moment) throw new Error(lookupError?.message || "Moment not found for the active Artist.");
  if (moment.state === "rejected" || moment.state === "superseded") {
    throw new Error("This Moment is historical and can no longer be edited.");
  }

  const startMs = Math.round(seconds.parse(value(form, "start_seconds")) * 1000);
  const endMs = Math.round(seconds.parse(value(form, "end_seconds")) * 1000);
  if (endMs <= startMs) throw new Error("Moment end must be after its start.");
  const label = labelSchema.parse(value(form, "label"));

  if (decision === "reject" && moment.state !== "proposed") {
    throw new Error("Only proposed Moments can be rejected.");
  }

  const nextState = decision === "approve"
    ? "approved" as const
    : decision === "reject"
      ? "rejected" as const
      : moment.state;
  const reviewed = decision === "approve" || decision === "reject";
  const { error } = await moments
    .from("moments")
    .update({
      start_ms: startMs,
      end_ms: endMs,
      label,
      state: nextState,
      reviewed_by: reviewed ? user.id : undefined,
      reviewed_at: reviewed ? new Date().toISOString() : undefined,
    })
    .eq("id", momentId)
    .eq("artist_id", artist.artistId)
    .eq("release_id", releaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/production");
}
