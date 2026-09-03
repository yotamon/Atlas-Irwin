"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import * as core from "./distribution-core-actions";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

const EDITABLE_STATES = new Set(["draft", "needs_attention", "ready", "rejected", "error"]);

function releaseId(form: FormData) {
  const value = String(form.get("release_id") ?? "").trim();
  if (!value) throw new Error("Release ID is required.");
  return value;
}

async function assertEditable(form: FormData) {
  const id = releaseId(form);
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const result = await db.from("release_distribution_configs")
    .select("state")
    .eq("release_id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (result.data && !EDITABLE_STATES.has(result.data.state)) {
    throw new Error(`Distribution metadata is locked while the release is '${result.data.state}'. Start a correction workflow before editing a distributed release.`);
  }
}

export async function saveDistributionDeclarations(form: FormData) {
  await assertEditable(form);
  return core.saveDistributionDeclarations(form);
}

export async function saveDistributionArtistProfile(form: FormData) {
  await assertEditable(form);
  return core.saveDistributionArtistProfile(form);
}

export async function saveDistributionTrackMetadata(form: FormData) {
  await assertEditable(form);
  return core.saveDistributionTrackMetadata(form);
}

export async function addDistributionTrackWriter(form: FormData) {
  await assertEditable(form);
  return core.addDistributionTrackWriter(form);
}

export async function removeDistributionTrackWriter(form: FormData) {
  await assertEditable(form);
  return core.removeDistributionTrackWriter(form);
}

export async function addDistributionTrackContributor(form: FormData) {
  await assertEditable(form);
  return core.addDistributionTrackContributor(form);
}

export async function removeDistributionTrackContributor(form: FormData) {
  await assertEditable(form);
  return core.removeDistributionTrackContributor(form);
}
