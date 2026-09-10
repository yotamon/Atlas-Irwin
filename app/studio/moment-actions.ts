"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMomentsClient } from "@/lib/studio/moments-db";

const uuid = z.uuid();
const seconds = z.coerce.number().finite().nonnegative().max(60 * 60 * 6);
const labelSchema = z.string().trim().min(1).max(180);
const purposeSchema = z.string().trim().max(180);
const decisionSchema = z.enum(["save", "approve", "reject"]);
const judgmentSchema = z.enum(["best", "useful", "poor", "adjustment"]);
const preferredCutSchema = z.enum(["6", "8", "15", "30"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function optionalUuid(form: FormData, key: string) {
  const raw = value(form, key);
  return raw ? uuid.parse(raw) : null;
}

export async function reviewMoment(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const moments = asMomentsClient(supabase);
  const momentId = uuid.parse(value(form, "moment_id"));
  const releaseId = uuid.parse(value(form, "release_id"));
  const decision = decisionSchema.parse(value(form, "decision"));
  const judgment = judgmentSchema.parse(value(form, "judgment") || "adjustment");
  const startMs = Math.round(seconds.parse(value(form, "start_seconds")) * 1000);
  const endMs = Math.round(seconds.parse(value(form, "end_seconds")) * 1000);
  if (endMs <= startMs) throw new Error("Moment end must be after its start.");
  const label = labelSchema.parse(value(form, "label"));
  const correctedPurpose = purposeSchema.parse(value(form, "corrected_purpose"));
  const cutRaw = value(form, "preferred_cut_seconds");
  const preferredCutSeconds = cutRaw ? Number(preferredCutSchema.parse(cutRaw)) : null;
  const preferredMomentId = optionalUuid(form, "preferred_moment_id");

  const { error } = await moments.rpc("review_moment_with_calibration", {
    p_moment_id: momentId,
    p_release_id: releaseId,
    p_decision: decision,
    p_start_ms: startMs,
    p_end_ms: endMs,
    p_label: label,
    p_judgment: judgment,
    p_corrected_purpose: correctedPurpose || null,
    p_preferred_cut_seconds: preferredCutSeconds,
    p_preferred_moment_id: preferredMomentId,
    p_evidence: { source: "best_moments_review" },
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/production");
  revalidatePath("/studio/memory");
}
