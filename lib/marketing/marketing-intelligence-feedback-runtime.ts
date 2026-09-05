import "server-only";

import { revalidatePath } from "next/cache";
import { MARKETING_REJECTION_REASONS } from "./marketing-intelligence-rejection-reasons";
import { actionContext, json, uuid, value } from "./marketing-intelligence-action-context";

function rejectionReason(reasonId: string) {
  const reason = MARKETING_REJECTION_REASONS.find((candidate) => candidate.id === reasonId);
  if (!reason) throw new Error("Choose a valid Campaign Intelligence rejection reason.");
  return reason;
}

async function feedbackContext(form: FormData) {
  const { user, artist, marketing, momentMarketing } = await actionContext(form);
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const variantId = uuid.parse(value(form, "variant_id"));
  const { data: variant, error: variantError } = await marketing.from("content_variants")
    .select("id,content_item_id,experiment_id,label,hook_text,caption,cta,visual_prompt,production_notes,approval_status")
    .eq("id", variantId).eq("owner_id", user.id).eq("artist_id", artist.artistId).single();
  if (variantError) throw new Error(variantError.message);
  const { data: item, error: itemError } = await momentMarketing.from("content_items")
    .select("id,campaign_id,release_id,title,platform,format,goal,content_angle,moment_id")
    .eq("id", variant.content_item_id).eq("owner_id", user.id).eq("artist_id", artist.artistId).single();
  if (itemError) throw new Error(itemError.message);
  if (!item.campaign_id || item.campaign_id !== campaignId) {
    throw new Error("Campaign Intelligence feedback must belong to a campaign-linked content item.");
  }
  if (variant.approval_status !== "pending") {
    throw new Error("This creative variant has already been reviewed.");
  }
  return { user, artist, marketing, campaignId, variantId, variant, item };
}

function refresh(campaignId: string) {
  revalidatePath(`/studio/campaigns/${campaignId}`);
  revalidatePath(`/studio/campaigns/${campaignId}/intelligence`);
  revalidatePath("/studio/analytics");
}

export async function approveIntelligentVariantImpl(form: FormData) {
  const { user, artist, marketing, campaignId, variantId, variant, item } = await feedbackContext(form);
  const { error: updateError } = await marketing.from("content_variants")
    .update({ approval_status: "approved", status: "approved" })
    .eq("id", variantId).eq("owner_id", user.id).eq("artist_id", artist.artistId);
  if (updateError) throw new Error(updateError.message);

  const finding = `Approved artist framing for ${item.platform} ${item.format}: ${variant.hook_text || item.content_angle || item.title}`;
  const { error: learningError } = await marketing.from("marketing_learnings").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    release_id: item.release_id,
    experiment_id: variant.experiment_id,
    scope: "content",
    finding,
    evidence: json({
      variantId,
      contentItemId: item.id,
      hookText: variant.hook_text,
      contentAngle: item.content_angle,
      platform: item.platform,
      format: item.format,
      momentId: item.moment_id,
      decision: "approved",
    }),
    confidence: 0.96,
    status: "approved",
    approved_at: new Date().toISOString(),
    applies_to: json({ platform: item.platform, format: item.format, goal: item.goal }),
    source: "manual",
  });
  if (learningError) throw new Error(learningError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    event_type: "content.variant_approved",
    entity_type: "content_variant",
    entity_id: variantId,
    payload: json({
      experimentId: variant.experiment_id,
      contentItemId: item.id,
      hookText: variant.hook_text,
      contentAngle: item.content_angle,
      platform: item.platform,
      format: item.format,
      momentId: item.moment_id,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(campaignId);
}

export async function rejectIntelligentVariantImpl(form: FormData) {
  const { user, artist, marketing, campaignId, variantId, variant, item } = await feedbackContext(form);
  const reason = rejectionReason(value(form, "reason"));
  const notes = value(form, "notes").slice(0, 500);
  const { error: updateError } = await marketing.from("content_variants")
    .update({ approval_status: "rejected", status: "rejected" })
    .eq("id", variantId).eq("owner_id", user.id).eq("artist_id", artist.artistId);
  if (updateError) throw new Error(updateError.message);

  const finding = [
    `Avoid rejected ${item.platform} ${item.format} framing: ${reason.label}.`,
    notes,
    variant.hook_text ? `Rejected hook: ${variant.hook_text}` : "",
  ].filter(Boolean).join(" ");
  const { error: learningError } = await marketing.from("marketing_learnings").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    release_id: item.release_id,
    experiment_id: variant.experiment_id,
    scope: "content",
    finding,
    evidence: json({
      variantId,
      contentItemId: item.id,
      reason: reason.id,
      reasonLabel: reason.label,
      notes,
      hookText: variant.hook_text,
      contentAngle: item.content_angle,
      visualPrompt: variant.visual_prompt,
      productionNotes: variant.production_notes,
      platform: item.platform,
      format: item.format,
      momentId: item.moment_id,
      decision: "rejected",
    }),
    confidence: 0.96,
    status: "approved",
    approved_at: new Date().toISOString(),
    applies_to: json({ platform: item.platform, format: item.format, goal: item.goal }),
    source: "manual",
  });
  if (learningError) throw new Error(learningError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    event_type: "content.variant_rejected",
    entity_type: "content_variant",
    entity_id: variantId,
    payload: json({
      experimentId: variant.experiment_id,
      contentItemId: item.id,
      reason: reason.id,
      reasonLabel: reason.label,
      notes,
      hookText: variant.hook_text,
      contentAngle: item.content_angle,
      platform: item.platform,
      format: item.format,
      momentId: item.moment_id,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(campaignId);
}
