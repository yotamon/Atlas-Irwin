"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import type { FanGraphDatabase, FanPermissionPurpose, FanPermissionStatus, FanRelationshipState } from "@/types/fan-graph-database";

function value(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }

async function context(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  return { db: supabase as unknown as SupabaseClient<FanGraphDatabase>, ownerId: user.id, artistId: artist.artistId };
}

async function assertFan(db: SupabaseClient<FanGraphDatabase>, ownerId: string, artistId: string, fanId: string) {
  const { data, error } = await db.from("fan_profiles").select("id").eq("id", fanId).eq("owner_id", ownerId).eq("artist_id", artistId).is("merged_into_fan_id", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Fan relationship not found for the active artist.");
}

function refresh(fanId?: string) {
  revalidatePath("/studio/audience");
  if (fanId) revalidatePath(`/studio/audience/fans/${fanId}`);
  revalidatePath("/studio/needs-you");
  revalidatePath("/studio");
}

export async function saveFanProfile(form: FormData) {
  const fanId = value(form, "fan_id");
  const state = value(form, "relationship_state") as FanRelationshipState;
  if (!fanId) throw new Error("Fan relationship is required.");
  if (!["new", "returning", "known_supporter", "inactive"].includes(state)) throw new Error("Unsupported relationship state.");
  const { db, ownerId, artistId } = await context(form);
  await assertFan(db, ownerId, artistId, fanId);
  const { error } = await db.from("fan_profiles").update({ display_name: value(form, "display_name") || null, relationship_state: state }).eq("id", fanId).eq("owner_id", ownerId).eq("artist_id", artistId);
  if (error) throw new Error(error.message);
  refresh(fanId);
}

export async function addVerifiedFanIdentity(form: FormData) {
  const fanId = value(form, "fan_id");
  const kind = value(form, "identity_kind");
  const raw = value(form, "identifier");
  if (!fanId || !raw) throw new Error("Fan relationship and verified contact are required.");
  if (form.get("confirm_verified") !== "on") throw new Error("Confirm that this contact identity has been verified before adding it.");
  const { db, ownerId, artistId } = await context(form);
  await assertFan(db, ownerId, artistId, fanId);

  let channel: "email" | "sms";
  let identifierKind: "verified_email" | "verified_phone";
  let subject: string;
  if (kind === "email") {
    channel = "email";
    identifierKind = "verified_email";
    subject = raw.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) throw new Error("Enter a valid verified email address.");
  } else if (kind === "phone") {
    channel = "sms";
    identifierKind = "verified_phone";
    subject = raw.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(subject)) throw new Error("Enter the verified phone number in international format, for example +491234567890.");
  } else {
    throw new Error("Only verified email or phone identities can be added manually.");
  }

  const { data: existing, error: existingError } = await db.from("fan_identities").select("id,fan_id").eq("artist_id", artistId).eq("channel", channel).eq("identifier_kind", identifierKind).eq("external_subject_id", subject).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && existing.fan_id !== fanId) throw new Error("That verified identity already belongs to another relationship. Merge the two relationships only if you have explicit identity evidence.");
  if (!existing) {
    const { error } = await db.from("fan_identities").insert({ fan_id: fanId, owner_id: ownerId, artist_id: artistId, channel, identifier_kind: identifierKind, external_subject_id: subject, handle: null, display_name: null, evidence_level: "verified", verified_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
  refresh(fanId);
}

export async function saveFanPermission(form: FormData) {
  const fanId = value(form, "fan_id");
  const identityId = value(form, "identity_id");
  const purpose = value(form, "purpose") as FanPermissionPurpose;
  const status = value(form, "status") as FanPermissionStatus;
  if (!fanId || !identityId) throw new Error("Fan relationship and channel identity are required.");
  if (!["proactive_updates", "release_marketing", "email_marketing", "sms_marketing"].includes(purpose)) throw new Error("Unsupported communication purpose.");
  if (!["unknown", "granted", "revoked"].includes(status)) throw new Error("Unsupported permission status.");

  const { db, ownerId, artistId } = await context(form);
  await assertFan(db, ownerId, artistId, fanId);
  const { data: identity, error: identityError } = await db.from("fan_identities").select("id,fan_id,channel,identifier_kind").eq("id", identityId).eq("fan_id", fanId).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle();
  if (identityError) throw new Error(identityError.message);
  if (!identity) throw new Error("Channel identity not found for this relationship.");
  if (purpose === "email_marketing" && identity.channel !== "email") throw new Error("Email marketing permission can only belong to a verified email identity.");
  if (purpose === "sms_marketing" && identity.channel !== "sms") throw new Error("SMS marketing permission can only belong to a verified phone identity.");
  if (identity.channel === "email" && identity.identifier_kind !== "verified_email") throw new Error("Email permissions require a verified email identity.");
  if (identity.channel === "sms" && identity.identifier_kind !== "verified_phone") throw new Error("SMS permissions require a verified phone identity.");

  const evidenceNote = value(form, "evidence_note");
  if (status === "granted" && evidenceNote.length < 3) throw new Error("Describe the consent evidence before recording permission as granted.");
  const { error } = await db.from("fan_permissions").upsert({ identity_id: identityId, owner_id: ownerId, artist_id: artistId, channel: identity.channel, purpose, status, source: status === "revoked" ? "privacy_request" : "artist_record", evidence_at: status === "unknown" ? null : new Date().toISOString(), evidence_note: evidenceNote || null, expires_at: null }, { onConflict: "identity_id,purpose" });
  if (error) throw new Error(error.message);
  refresh(fanId);
}

export async function mergeFanProfiles(form: FormData) {
  const sourceFanId = value(form, "source_fan_id");
  const targetFanId = value(form, "target_fan_id");
  const evidenceType = value(form, "evidence_type");
  const evidenceNote = value(form, "evidence_note");
  if (!sourceFanId || !targetFanId) throw new Error("Choose both relationships to merge.");
  const { db, ownerId, artistId } = await context(form);
  await Promise.all([assertFan(db, ownerId, artistId, sourceFanId), assertFan(db, ownerId, artistId, targetFanId)]);
  if (!["explicit_confirmation", "verified_contact_match", "provider_verified_link"].includes(evidenceType)) throw new Error("Cross-channel merges require explicit or verified identity evidence.");
  const { error } = await db.rpc("merge_fan_profiles", { p_source_fan_id: sourceFanId, p_target_fan_id: targetFanId, p_evidence_type: evidenceType, p_evidence_note: evidenceNote });
  if (error) throw new Error(error.message);
  refresh(targetFanId);
}

export async function revertFanMerge(form: FormData) {
  const mergeId = value(form, "merge_id");
  const fanId = value(form, "fan_id");
  if (!mergeId) throw new Error("Merge event is required.");
  const { db } = await context(form);
  const { error } = await db.rpc("revert_fan_merge", { p_merge_id: mergeId });
  if (error) throw new Error(error.message);
  refresh(fanId || undefined);
}

export async function revokeFanPermissions(form: FormData) {
  const fanId = value(form, "fan_id");
  if (!fanId) throw new Error("Fan relationship is required.");
  const { db, ownerId, artistId } = await context(form);
  await assertFan(db, ownerId, artistId, fanId);
  const channel = value(form, "channel") || null;
  const { error } = await db.rpc("revoke_fan_permissions", { p_fan_id: fanId, p_channel: channel });
  if (error) throw new Error(error.message);
  refresh(fanId);
}

export async function deleteFanPersonalData(form: FormData) {
  const fanId = value(form, "fan_id");
  if (!fanId) throw new Error("Fan relationship is required.");
  if (value(form, "confirm_delete") !== "DELETE") throw new Error("Type DELETE to confirm the privacy deletion.");
  const { db, ownerId, artistId } = await context(form);
  await assertFan(db, ownerId, artistId, fanId);
  const { error } = await db.rpc("delete_fan_personal_data", { p_fan_id: fanId });
  if (error) throw new Error(error.message);
  refresh();
  redirect("/studio/audience");
}
