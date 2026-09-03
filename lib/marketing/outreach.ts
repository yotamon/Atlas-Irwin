import "server-only";

import { createCatalogClient } from "@/lib/supabase/service";
import { createMarketingServiceClient } from "./db";

export type MarketingExecutionScope = {
  ownerId: string;
  artistId: string;
};

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

export async function processDueOutreachEnrollments(limit = 25, scope?: MarketingExecutionScope) {
  const marketing = createMarketingServiceClient();
  const catalog = createCatalogClient();
  const now = new Date().toISOString();
  let enrollmentQuery = marketing
    .from("outreach_enrollments")
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (scope) {
    enrollmentQuery = enrollmentQuery
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId);
  }
  const { data: enrollments, error } = await enrollmentQuery;
  if (error) throw new Error(error.message);

  let draftsCreated = 0;
  for (const enrollment of enrollments ?? []) {
    if (!enrollment.artist_id) throw new Error("Outreach enrollment is missing artist scope.");
    const [sequenceResult, stepResult, contactResult, campaignResult] = await Promise.all([
      marketing.from("outreach_sequences").select("*")
        .eq("id", enrollment.sequence_id)
        .eq("owner_id", enrollment.owner_id)
        .eq("artist_id", enrollment.artist_id)
        .single(),
      marketing.from("outreach_sequence_steps").select("*")
        .eq("sequence_id", enrollment.sequence_id)
        .eq("artist_id", enrollment.artist_id)
        .eq("step_order", enrollment.next_step_order)
        .maybeSingle(),
      marketing.from("outreach_contacts").select("*")
        .eq("id", enrollment.contact_id)
        .eq("owner_id", enrollment.owner_id)
        .eq("artist_id", enrollment.artist_id)
        .single(),
      enrollment.campaign_id
        ? marketing.from("campaigns").select("release_id,name")
            .eq("id", enrollment.campaign_id)
            .eq("owner_id", enrollment.owner_id)
            .eq("artist_id", enrollment.artist_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (sequenceResult.error) throw new Error(sequenceResult.error.message);
    if (stepResult.error) throw new Error(stepResult.error.message);
    if (contactResult.error) throw new Error(contactResult.error.message);
    if (campaignResult.error) throw new Error(campaignResult.error.message);
    const sequence = sequenceResult.data;
    const step = stepResult.data;
    if (!step || sequence.status !== "active") {
      const { error: completeError } = await marketing.from("outreach_enrollments").update({
        status: "completed",
        next_run_at: null,
        stopped_reason: step ? "sequence_not_active" : "sequence_complete",
      }).eq("id", enrollment.id).eq("artist_id", enrollment.artist_id);
      if (completeError) throw new Error(completeError.message);
      continue;
    }

    const { data: existingDraft, error: draftLookupError } = await marketing
      .from("outreach_messages")
      .select("id")
      .eq("artist_id", enrollment.artist_id)
      .eq("sequence_enrollment_id", enrollment.id)
      .eq("sequence_step_id", step.id)
      .is("sent_at", null)
      .limit(1)
      .maybeSingle();
    if (draftLookupError) throw new Error(draftLookupError.message);
    if (existingDraft) {
      const { error: pauseError } = await marketing.from("outreach_enrollments").update({
        status: "paused",
        next_run_at: null,
        stopped_reason: `awaiting_send:${existingDraft.id}`,
      }).eq("id", enrollment.id).eq("artist_id", enrollment.artist_id);
      if (pauseError) throw new Error(pauseError.message);
      continue;
    }

    let releaseTitle = "the artist's current release";
    let smartLink = "";
    const releaseId = campaignResult.data?.release_id ?? null;
    if (releaseId) {
      const { data: release, error: releaseError } = await catalog
        .from("releases")
        .select("title,smart_link_url,spotify_url,soundcloud_url")
        .eq("id", releaseId)
        .eq("owner_id", enrollment.owner_id)
        .eq("artist_id", enrollment.artist_id)
        .maybeSingle();
      if (releaseError) throw new Error(releaseError.message);
      if (release) {
        releaseTitle = release.title;
        smartLink = release.smart_link_url || release.spotify_url || release.soundcloud_url || "";
      }
    }

    const contact = contactResult.data;
    const message = renderTemplate(step.message_template, {
      name: contact.name,
      release: releaseTitle,
      link: smartLink,
      city: contact.city || "",
      type: contact.contact_type,
    }).trim();
    const { data: draft, error: draftError } = await marketing
      .from("outreach_messages")
      .insert({
        owner_id: enrollment.owner_id,
        artist_id: enrollment.artist_id,
        contact_id: enrollment.contact_id,
        release_id: releaseId,
        campaign_id: enrollment.campaign_id,
        sequence_enrollment_id: enrollment.id,
        sequence_step_id: step.id,
        channel: step.channel,
        message,
        sent_at: null,
        follow_up_at: null,
        response_status: "Draft",
        response_notes: null,
      })
      .select("id")
      .single();
    if (draftError) throw new Error(draftError.message);
    const { error: pauseError } = await marketing.from("outreach_enrollments").update({
      status: "paused",
      next_run_at: null,
      stopped_reason: `awaiting_send:${draft.id}`,
    }).eq("id", enrollment.id).eq("artist_id", enrollment.artist_id);
    if (pauseError) throw new Error(pauseError.message);
    draftsCreated += 1;
  }
  return { considered: enrollments?.length ?? 0, draftsCreated };
}
