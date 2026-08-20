"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

const money = z.coerce.number().finite().min(0).max(10000);

export async function saveAiControlSettings(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const client = asMarketingClient(supabase);
  const parsed = z.object({
    routing_mode: z.enum(["auto", "economy", "balanced", "premium"]),
    provider_sort: z.enum(["cost", "ttft", "tps"]),
    monthly_budget_usd: money,
    text_budget_usd: money,
    image_budget_usd: money,
    video_budget_usd: money,
  }).parse({
    routing_mode: value(form, "routing_mode") || "auto",
    provider_sort: value(form, "provider_sort") || "cost",
    monthly_budget_usd: value(form, "monthly_budget_usd"),
    text_budget_usd: value(form, "text_budget_usd"),
    image_budget_usd: value(form, "image_budget_usd"),
    video_budget_usd: value(form, "video_budget_usd"),
  });

  const { data: current, error: currentError } = await client
    .from("ai_control_settings")
    .select("task_overrides")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);

  const { error } = await client.from("ai_control_settings").upsert({
    owner_id: user.id,
    ...parsed,
    hard_stop: form.get("hard_stop") === "on",
    quality_escalation: form.get("quality_escalation") === "on",
    task_overrides: current?.task_overrides ?? {},
  }, { onConflict: "owner_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/studio/settings/ai");
  revalidatePath("/studio/settings");
}
