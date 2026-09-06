"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatVisualBrandPrompt } from "@/lib/brand/visual-brand-dna";
import { loadActiveVisualBrand } from "@/lib/brand/visual-brand-store";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { requireStudioAdmin } from "@/lib/auth/studio";
import type { Json } from "@/types/database";

const text = z.string().trim().min(1).max(6000);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function content(textValue: string, derivedFrom?: string) {
  return { text: textValue, ...(derivedFrom ? { derived_from: derivedFrom } : {}) } as Json;
}

export async function saveBrandProfileV2(form: FormData) {
  const requestedArtistId = value(form, "artist_id") || undefined;
  const artist = await requireArtistContext(requestedArtistId);
  const { supabase } = await requireStudioAdmin();
  const operational = asArtistScopedOperationalClient(supabase);
  const essence = text.parse(value(form, "essence"));
  const voice = text.parse(value(form, "voice"));
  const music = text.parse(value(form, "music"));
  const visual = text.parse(value(form, "visual"));
  const audience = text.parse(value(form, "audience"));
  const exclusions = value(form, "exclusions") || "Avoid generic AI aesthetics, cheap cyberpunk, visual clichés, hype language, and anything that feels templated rather than intentional.";
  const activeVisual = await loadActiveVisualBrand({
    db: supabase,
    ownerId: artist.userId,
    artistId: artist.artistId,
  });
  const visualWorld = activeVisual?.dna.thesis || visual;
  const visualExclusions = activeVisual?.dna.antiStyle.join("; ") || exclusions;
  const visualPrompt = activeVisual
    ? formatVisualBrandPrompt(activeVisual.prompt)
    : `Use this visual world as the base: ${visual}. Keep outputs coherent with the music world: ${music}. Exclude: ${exclusions}. Prefer specific scene, light, material, movement and camera direction over style buzzwords.`;
  const continuityRules = activeVisual?.dna.continuityRules.join("; ")
    || "Treat release artwork and artist-tagged approved references as art-direction evidence. Extend the same visual DNA rather than inventing a new identity for every post.";

  const derived = {
    "Brand essence": essence,
    "Voice and tone": voice,
    "Music world": music,
    "Visual world": visualWorld,
    Audience: audience,
    "Visual exclusions": visualExclusions,
    "Visual continuity rules": continuityRules,
    "AI narrative guidance": `Use AI as a production tool, never as the artistic premise. Keep the artist's taste, direction and emotional intention primary. Brand essence: ${essence}`,
    "Caption templates": `Write in this voice: ${voice}. Start from a specific emotional or musical truth, add one concrete detail from the release, and finish with one quiet invitation. Avoid generic promotional claims.`,
    "Visual prompt templates": visualPrompt,
    "Outreach message templates": `Write concise personal outreach for this audience: ${audience}. Voice: ${voice}. Explain why the specific release may fit the recipient before asking for anything. Never use mass-mail language or exaggerated claims.`,
  } as const;

  for (const [section, textValue] of Object.entries(derived)) {
    const { data: existing, error: lookupError } = await operational
      .from("brand_settings")
      .select("id")
      .eq("owner_id", artist.userId)
      .eq("artist_id", artist.artistId)
      .eq("section", section)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    const derivedFrom = activeVisual && ["Visual world", "Visual exclusions", "Visual continuity rules", "Visual prompt templates"].includes(section)
      ? "visual-brand-dna-v1"
      : undefined;
    const mutation = existing
      ? operational.from("brand_settings").update({ content: content(textValue, derivedFrom) }).eq("id", existing.id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      : operational.from("brand_settings").insert({ owner_id: artist.userId, artist_id: artist.artistId, section, content: content(textValue, derivedFrom) });
    const { error } = await mutation;
    if (error) throw new Error(error.message);
  }

  revalidatePath("/studio/settings/brand");
  revalidatePath("/studio/brand");
  revalidatePath("/studio/settings");
}
