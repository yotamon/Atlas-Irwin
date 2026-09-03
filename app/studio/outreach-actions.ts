"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

const required = z.string().trim().min(1).max(300);
const text = z.string().trim().max(10000);
const number = z.coerce.number().int().nonnegative().default(0);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}
function list(form: FormData, key: string) {
  return value(form, key).split(",").map((item) => item.trim()).filter(Boolean);
}

async function outreachContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, z.uuid().parse(requestedArtistId))
    : await resolveDefaultArtistContext(supabase, user);
  return {
    artist,
    operational: asArtistScopedOperationalClient(supabase),
    music: asArtistScopedMusicClient(supabase),
  };
}

export async function saveContact(form: FormData) {
  const { artist, operational } = await outreachContext(form);
  const id = value(form, "id");
  const row = {
    owner_id: artist.userId,
    artist_id: artist.artistId,
    name: required.parse(value(form, "name")),
    platform: nullable(form, "platform"),
    handle_or_url: nullable(form, "handle_or_url"),
    email: nullable(form, "email"),
    city: nullable(form, "city"),
    country: nullable(form, "country"),
    contact_type: required.parse(value(form, "contact_type")),
    genres: list(form, "genres"),
    audience_size: value(form, "audience_size") ? number.parse(value(form, "audience_size")) : null,
    contact_method: nullable(form, "contact_method"),
    relationship_status: required.parse(value(form, "relationship_status")),
    notes: nullable(form, "notes"),
    tags: list(form, "tags"),
  };
  const mutation = id
    ? operational.from("outreach_contacts").update(row)
        .eq("id", z.uuid().parse(id))
        .eq("owner_id", artist.userId)
        .eq("artist_id", artist.artistId)
    : operational.from("outreach_contacts").insert(row);
  const { error } = await mutation;
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
  if (id) revalidatePath(`/studio/outreach/${id}`);
}

export async function saveOutreachMessage(form: FormData) {
  const { artist, operational, music } = await outreachContext(form);
  const contactId = z.uuid().parse(value(form, "contact_id"));
  const releaseId = value(form, "release_id") ? z.uuid().parse(value(form, "release_id")) : null;

  const { data: contact, error: contactError } = await operational.from("outreach_contacts")
    .select("id")
    .eq("id", contactId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (contactError) throw new Error(contactError.message);
  if (!contact) throw new Error("Contact does not belong to the active artist.");

  if (releaseId) {
    const { data: release, error: releaseError } = await music.from("releases")
      .select("id")
      .eq("id", releaseId)
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (releaseError) throw new Error(releaseError.message);
    if (!release) throw new Error("Release does not belong to the active artist.");
  }

  const { error } = await operational.from("outreach_messages").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    contact_id: contactId,
    release_id: releaseId,
    channel: required.parse(value(form, "channel")),
    message: text.parse(value(form, "message")),
    sent_at: nullable(form, "sent_at"),
    follow_up_at: nullable(form, "follow_up_at"),
    response_status: nullable(form, "response_status"),
    response_notes: nullable(form, "response_notes"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
  revalidatePath(`/studio/outreach/${contactId}`);
}

export async function updateOutreachResponse(form: FormData) {
  const { artist, operational } = await outreachContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const { data: message, error: lookupError } = await operational.from("outreach_messages")
    .select("id,contact_id")
    .eq("id", id)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!message) throw new Error("Outreach message does not belong to the active artist.");

  const { error } = await operational.from("outreach_messages").update({
    response_status: nullable(form, "response_status"),
    response_notes: nullable(form, "response_notes"),
    follow_up_at: nullable(form, "follow_up_at"),
  }).eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/outreach");
  revalidatePath(`/studio/outreach/${message.contact_id}`);
}

export async function deleteOutreachRecord(form: FormData) {
  const { artist, operational } = await outreachContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const table = z.enum(["outreach_contacts", "outreach_messages"]).parse(value(form, "table"));
  if (table === "outreach_contacts") {
    const { error } = await operational.from("outreach_contacts").delete()
      .eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await operational.from("outreach_messages").delete()
      .eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/studio/outreach");
}
