"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { processDuePublicationJobs } from "@/lib/marketing/publications";
import { runMarketingAutomationCycle } from "@/lib/marketing/automation";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";

const SAFE_INTERNAL_AUTOMATION = new Set(["generate_winner_derivatives", "evaluate_experiment", "collect_metrics"]);

function ids(form: FormData, key: string) {
  return form.getAll(key).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}
function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function inboxContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requested = value(form, "artist_id");
  const artist = requested
    ? await resolveArtistContext(supabase, user, z.uuid().parse(requested))
    : await resolveDefaultArtistContext(supabase, user);
  return { artist, marketing: asMarketingClient(supabase) };
}

export async function approveInboxBatch(form: FormData) {
  const { artist, marketing } = await inboxContext(form);
  const publicationIds = ids(form, "publication_id");
  const automationIds = ids(form, "automation_id");

  if (publicationIds.length) {
    const { error } = await marketing.from("publication_jobs")
      .update({ approval_status: "approved", status: "approved" })
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("status", "awaiting_approval")
      .in("id", publicationIds);
    if (error) throw new Error(error.message);
  }

  if (automationIds.length) {
    const { data: jobs, error } = await marketing.from("automation_jobs")
      .select("id,job_type")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("status", "awaiting_approval")
      .in("id", automationIds);
    if (error) throw new Error(error.message);
    const safeIds = (jobs ?? []).filter((job) => SAFE_INTERNAL_AUTOMATION.has(job.job_type)).map((job) => job.id);
    if (safeIds.length) {
      const { error: updateError } = await marketing.from("automation_jobs")
        .update({ approval_status: "approved", status: "queued" })
        .eq("owner_id", artist.userId)
        .eq("artist_id", artist.artistId)
        .in("id", safeIds);
      if (updateError) throw new Error(updateError.message);
    }
  }

  const scope = { ownerId: artist.userId, artistId: artist.artistId };
  await processDuePublicationJobs(20, scope);
  await runMarketingAutomationCycle(artist.artistId);

  revalidatePath("/studio");
  revalidatePath("/studio/inbox");
  revalidatePath("/studio/production");
}

export async function rejectInboxBatch(form: FormData) {
  const { artist, marketing } = await inboxContext(form);
  const publicationIds = ids(form, "publication_id");
  const automationIds = ids(form, "automation_id");

  if (publicationIds.length) {
    const { error } = await marketing.from("publication_jobs")
      .update({ approval_status: "rejected", status: "cancelled" })
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("status", "awaiting_approval")
      .in("id", publicationIds);
    if (error) throw new Error(error.message);
  }
  if (automationIds.length) {
    const { error } = await marketing.from("automation_jobs")
      .update({ approval_status: "rejected", status: "cancelled" })
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("status", "awaiting_approval")
      .in("id", automationIds);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/studio");
  revalidatePath("/studio/inbox");
}
