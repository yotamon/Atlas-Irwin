"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import type { Json } from "@/types/database";

const text = z.string().trim().min(1).max(6000);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function content(textValue: string) {
  return { text: textValue } as Json;
}

export async function saveBrandProfileV2(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const essence = text.parse(value(form, "essence"));
  const voice = text.parse(value(form, "voice"));
  const music = text.parse(value(form, "music"));
  const visual = text.parse(value(form, "visual"));
  const audience = text.parse(value(form, "audience"));
  const exclusions = value(form, "exclusions") || "Avoid generic AI aesthetics, cheap cyberpunk, visual clichés, hype language, and anything that feels templated rather than intentional.";

  const derived = {
    "Brand essence": essence,
    "Voice and tone": voice,
    "Music world": music,
    "Visual world": visual,
    Audience: audience,
    "Visual exclusions": exclusions,
    "AI narrative guidance": `Use AI as a production tool, never as the artistic premise. Keep the artist's taste, direction and emotional intention primary. Brand essence: ${essence}`,
    "Caption templates": `Write in this voice: ${voice}. Start from a specific emotional or musical truth, add one concrete detail from the release, and finish with one quiet invitation. Avoid generic promotional claims.`,
    "Visual prompt templates": `Use this visual world as the base: ${visual}. Keep outputs coherent with the music world: ${music}. Exclude: ${exclusions}. Prefer specific scene, light, material, movement and camera direction over style buzzwords.`,
    "Outreach message templates": `Write concise personal outreach for this audience: ${audience}. Voice: ${voice}. Explain why the specific release may fit the recipient before asking for anything. Never use mass-mail language or exaggerated claims.`,
  } as const;

  for (const [section, textValue] of Object.entries(derived)) {
    const { data: existing, error: lookupError } = await supabase
      .from("brand_settings")
      .select("id")
      .eq("owner_id", user.id)
      .eq("section", section)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    const mutation = existing
      ? supabase.from("brand_settings").update({ content: content(textValue) }).eq("id", existing.id).eq("owner_id", user.id)
      : supabase.from("brand_settings").insert({ owner_id: user.id, section, content: content(textValue) });
    const { error } = await mutation;
    if (error) throw new Error(error.message);
  }

  revalidatePath("/studio/settings/brand");
  revalidatePath("/studio/brand");
  revalidatePath("/studio/settings");
}
