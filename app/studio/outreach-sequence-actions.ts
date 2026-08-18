"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { processDueOutreachEnrollments } from "@/lib/marketing/outreach";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function createOutreachSequence(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const campaignId = z.uuid().parse(value(form, "campaign_id"));
  const name = z.string().min(1).max(160).parse(value(form, "name"));
  const channel = z.string().min(1).max(80).parse(value(form, "channel") || "Instagram DM");
  const firstMessage = z.string().min(1).max(6000).parse(value(form, "message_template"));
  const followup = z.string().min(1).max(6000).parse(value(form, "followup_template"));
  const delayDays = z.coerce.number().int().min(1).max(30).parse(value(form, "followup_delay_days") || "7");

  const { data: campaign, error: campaignError } = await marketing
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("owner_id", user.id)
    .single();
  if (campaignError) throw new Error(campaignError.message);

  const { data: sequence, error } = await marketing.from("outreach_sequences").insert({
    owner_id: user.id,
    campaign_id: campaign.id,
    name,
    status: "active",
    audience_filter: {},
    stop_on_reply: true,
  }).select("id").single();
  if (error) throw new Error(error.message);

  const { error: stepsError } = await marketing.from("outreach_sequence_steps").insert([
    {
      owner_id: user.id,
      sequence_id: sequence.id,
      step_order: 0,
      delay_days: 0,
      channel,
      message_template: firstMessage,
      objective: "Introduce release",
      requires_approval: true,
    },
    {
      owner_id: user.id,
      sequence_id: sequence.id,
      step_order: 1,
      delay_days: delayDays,
      channel,
      message_template: followup,
      objective: "Respectful follow-up",
      requires_approval: true,
    },
  ]);
  if (stepsError) throw new Error(stepsError.message);
  revalidatePath("/studio/outreach");
}

export async function enrollOutreachContact(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const sequenceId = z.uuid().parse(value(form, "sequence_id"));
  const contactId = z.uuid().parse(value(form, "contact_id"));
  const { data: sequence, error: sequenceError } = await marketing
    .from("outreach_sequences")
    .select("id,campaign_id,status")
    .eq("id", sequenceId)
    .eq("owner_id", user.id)
    .single();
  if (sequenceError) throw new Error(sequenceError.message);
  if (sequence.status !== "active") throw new Error("Activate the sequence before enrolling contacts.");
  const { error: contactError } = await supabase
    .from("outreach_contacts")
    .select("id")
    .eq("id", contactId)
    .eq("owner_id", user.id)
    .single();
  if (contactError) throw new Error(contactError.message);

  const { error } = await marketing.from("outreach_enrollments").insert({
    owner_id: user.id,
    sequence_id: sequence.id,
    contact_id: contactId,
    campaign_id: sequence.campaign_id,
    status: "active",
    next_step_order: 0,
    next_run_at: new Date().toISOString(),
  });
  if (error && !error.message.toLowerCase().includes("duplicate")) throw new Error(error.message);

  await processDueOutreachEnrollments(10);
  revalidatePath("/studio/outreach");
}

export async function markSequenceMessageSent(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const messageId = z.uuid().parse(value(form, "message_id"));
  const { data: message, error: messageError } = await marketing
    .from("outreach_messages")
    .select("id,sequence_enrollment_id,sequence_step_id,sent_at")
    .eq("id", messageId)
    .eq("owner_id", user.id)
    .single();
  if (messageError) throw new Error(messageError.message);
  if (!message.sequence_enrollment_id || !message.sequence_step_id) throw new Error("This message is not part of an automated outreach sequence.");
  if (message.sent_at) return;

  const [stepResult, enrollmentResult] = await Promise.all([
    marketing.from("outreach_sequence_steps").select("sequence_id,step_order").eq("id", message.sequence_step_id).single(),
    marketing.from("outreach_enrollments").select("*").eq("id", message.sequence_enrollment_id).eq("owner_id", user.id).single(),
  ]);
  if (stepResult.error) throw new Error(stepResult.error.message);
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);

  const sentAt = new Date().toISOString();
  const { error: sentError } = await marketing.from("outreach_messages").update({
    sent_at: sentAt,
    response_status: "Sent",
  }).eq("id", message.id);
  if (sentError) throw new Error(sentError.message);

  const { data: nextStep, error: nextStepError } = await marketing
    .from("outreach_sequence_steps")
    .select("step_order,delay_days")
    .eq("sequence_id", stepResult.data.sequence_id)
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
  const { error: enrollmentUpdateError } = await marketing
    .from("outreach_enrollments")
    .update(update)
    .eq("id", enrollmentResult.data.id);
  if (enrollmentUpdateError) throw new Error(enrollmentUpdateError.message);
  revalidatePath("/studio/outreach");
}

export async function updateOutreachSequenceStatus(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const sequenceId = z.uuid().parse(value(form, "sequence_id"));
  const status = z.enum(["draft", "active", "paused", "completed", "archived"]).parse(value(form, "status"));
  const { error } = await marketing.from("outreach_sequences").update({ status }).eq("id", sequenceId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
}
