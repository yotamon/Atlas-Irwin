"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { deliverOutreach } from "@/lib/marketing/outreach-delivery";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

function ids(form: FormData, key: string) {
  return form.getAll(key).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}
function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function outreachContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requested = value(form, "artist_id");
  const artist = requested
    ? await resolveArtistContext(supabase, user, z.uuid().parse(requested))
    : await resolveDefaultArtistContext(supabase, user);
  return {
    artist,
    marketing: asMarketingClient(supabase),
    operational: asArtistScopedOperationalClient(supabase),
  };
}

async function advanceEnrollment(
  marketing: ReturnType<typeof asMarketingClient>,
  ownerId: string,
  artistId: string,
  enrollmentId: string,
  stepId: string,
) {
  const [stepResult, enrollmentResult] = await Promise.all([
    marketing.from("outreach_sequence_steps").select("sequence_id,step_order")
      .eq("id", stepId).eq("artist_id", artistId).single(),
    marketing.from("outreach_enrollments").select("*")
      .eq("id", enrollmentId).eq("owner_id", ownerId).eq("artist_id", artistId).single(),
  ]);
  if (stepResult.error) throw new Error(stepResult.error.message);
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);

  const { data: nextStep, error: nextStepError } = await marketing.from("outreach_sequence_steps")
    .select("step_order,delay_days")
    .eq("sequence_id", stepResult.data.sequence_id)
    .eq("artist_id", artistId)
    .gt("step_order", stepResult.data.step_order)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextStepError) throw new Error(nextStepError.message);

  const update = nextStep
    ? {
        status: "active" as const,
        next_step_order: nextStep.step_order,
        next_run_at: new Date(Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000).toISOString(),
        stopped_reason: null,
      }
    : {
        status: "completed" as const,
        next_run_at: null,
        stopped_reason: "sequence_complete",
      };
  const { error } = await marketing.from("outreach_enrollments").update(update)
    .eq("id", enrollmentResult.data.id).eq("owner_id", ownerId).eq("artist_id", artistId);
  if (error) throw new Error(error.message);
}

export async function approveOutreachDrafts(form: FormData) {
  const { artist, marketing, operational } = await outreachContext(form);
  const messageIds = ids(form, "outreach_id");
  if (!messageIds.length) return;

  const { data: messages, error } = await marketing.from("outreach_messages")
    .select("*")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .is("sent_at", null)
    .eq("response_status", "Draft")
    .in("id", messageIds);
  if (error) throw new Error(error.message);

  for (const message of messages ?? []) {
    const { data: contact, error: contactError } = await operational.from("outreach_contacts")
      .select("name,email,handle_or_url,platform")
      .eq("id", message.contact_id)
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .single();
    if (contactError) throw new Error(contactError.message);

    const result = await deliverOutreach({
      channel: message.channel,
      recipient: {
        name: contact.name,
        email: contact.email,
        handleOrUrl: contact.handle_or_url,
        platform: contact.platform,
      },
      message: message.message,
    });

    if (result.status === "manual_handoff") {
      const { error: handoffError } = await marketing.from("outreach_messages").update({
        response_status: "Ready to send",
        response_notes: "Approved in Studio V2. No connected delivery adapter is configured for this channel, so Ensemblis prepared a manual handoff.",
      }).eq("id", message.id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
      if (handoffError) throw new Error(handoffError.message);
      continue;
    }

    const sentAt = new Date().toISOString();
    const { error: sentError } = await marketing.from("outreach_messages").update({
      sent_at: sentAt,
      response_status: "Sent",
      response_notes: result.externalUrl ? `Delivered automatically: ${result.externalUrl}` : "Delivered automatically through the connected Ensemblis adapter.",
    }).eq("id", message.id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
    if (sentError) throw new Error(sentError.message);

    if (message.sequence_enrollment_id && message.sequence_step_id) {
      await advanceEnrollment(marketing, artist.userId, artist.artistId, message.sequence_enrollment_id, message.sequence_step_id);
    }
  }

  revalidatePath("/studio");
  revalidatePath("/studio/inbox");
  revalidatePath("/studio/outreach");
}

export async function rejectOutreachDrafts(form: FormData) {
  const { artist, marketing } = await outreachContext(form);
  const messageIds = ids(form, "outreach_id");
  if (!messageIds.length) return;
  const { error } = await marketing.from("outreach_messages").update({
    response_status: "Rejected",
    response_notes: "Rejected from the Ensemblis approval inbox.",
  }).eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .is("sent_at", null)
    .eq("response_status", "Draft")
    .in("id", messageIds);
  if (error) throw new Error(error.message);
  revalidatePath("/studio");
  revalidatePath("/studio/inbox");
  revalidatePath("/studio/outreach");
}
