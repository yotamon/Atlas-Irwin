"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { refreshNextBestActions } from "@/lib/marketing/next-best-action";
import { refreshMarketingRadarIfDue } from "@/lib/marketing/radar";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function refreshAutopilot() {
  await requireStudioAdmin();
  await refreshMarketingRadarIfDue();
  await refreshNextBestActions();
  revalidatePath("/studio/autopilot");
  revalidatePath("/studio");
}

export async function dismissNextBestAction(form: FormData) {
  const { user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const db = createAutonomyServiceClient();
  const { error } = await db.from("next_best_actions").update({ status: "dismissed" }).eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/autopilot");
}

export async function dismissMarketingOpportunity(form: FormData) {
  const { user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const db = createAutonomyServiceClient();
  const { error } = await db.from("marketing_opportunities").update({ status: "dismissed" }).eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/autopilot");
}
