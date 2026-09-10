"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import type { OnboardingDatabase } from "@/types/onboarding-database";

type Db = SupabaseClient<OnboardingDatabase>;

const projectType = z.enum(["human", "ai_assisted", "hybrid", "virtual_persona"]);

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function onboardingContext() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  return { db: supabase as unknown as Db, artist };
}

export async function confirmArtistIdentityAction(form: FormData) {
  const { db, artist } = await onboardingContext();
  const requestedArtistId = z.uuid().parse(text(form, "artist_id"));
  if (requestedArtistId !== artist.artistId) throw new Error("Artist context changed. Reload onboarding and try again.");
  const name = z.string().trim().min(1).max(120).parse(text(form, "artist_name"));
  const selectedType = projectType.parse(text(form, "project_type") || "human");
  const { error } = await db.rpc("confirm_ensemblis_artist_identity", {
    p_artist_id: artist.artistId,
    p_name: name,
    p_project_type: selectedType,
  });
  if (error) throw new Error(error.message);
  redirect(`/studio/onboarding?artist=${encodeURIComponent(artist.artistId)}`);
}

export async function recordOnboardingStartedAction(artistId: string) {
  const parsed = z.uuid().parse(artistId);
  const { db, artist } = await onboardingContext();
  if (parsed !== artist.artistId) return;
  const { error } = await db.rpc("record_ensemblis_activation_ui_event", {
    p_artist_id: artist.artistId,
    p_event_type: "onboarding_started",
  });
  if (error) throw new Error(error.message);
}

export async function dismissOnboardingAction(form: FormData) {
  const requested = z.uuid().parse(text(form, "artist_id"));
  const { db, artist } = await onboardingContext();
  if (requested !== artist.artistId) throw new Error("Artist context changed. Reload onboarding and try again.");
  const { error } = await db.rpc("record_ensemblis_activation_ui_event", {
    p_artist_id: artist.artistId,
    p_event_type: "onboarding_dismissed",
  });
  if (error) throw new Error(error.message);
  redirect(`/studio?artist=${encodeURIComponent(artist.artistId)}`);
}