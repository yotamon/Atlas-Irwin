"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { mediaMetadata } from "@/lib/studio/media";
import { analyzeVisualBrandEvidence, type VisualBrandEvidence } from "@/lib/brand/visual-brand-analysis";
import { formatVisualBrandPrompt, parseVisualBrandDna, toVisualBrandPromptContext } from "@/lib/brand/visual-brand-dna";
import type { Json, MediaAsset } from "@/types/database";
import type { VisualBrandDatabase, VisualBrandVersionRow } from "@/types/visual-brand-database";

const maturitySchema = z.enum(["starting", "emerging", "established"]);
const useCaseSchema = z.enum(["release_artwork", "social", "video", "artist_profile", "posters", "website"]);
const humanUsageSchema = z.enum(["none", "rare", "regular", "central"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function visualDb(db: SupabaseClient) {
  return db as unknown as SupabaseClient<VisualBrandDatabase>;
}

function relationship(asset: MediaAsset): VisualBrandEvidence["relationship"] | null {
  const tags = new Set(mediaMetadata(asset).tags.map((tag) => tag.toLowerCase()));
  if (tags.has("brand:avoid")) return "avoid";
  if (tags.has("brand:experimental")) return "experimental";
  if (tags.has("brand:inspiration")) return "inspiration";
  if (tags.has("brand:official")) return "official";
  if (asset.asset_type === "brand_reference" || asset.asset_type === "brand_logo") return "official";
  return null;
}

function artistEvidence(assets: MediaAsset[], artistId: string) {
  const artistTag = `artist:${artistId}`.toLowerCase();
  return assets.flatMap((asset): VisualBrandEvidence[] => {
    if (!asset.mime_type?.startsWith("image/") || !asset.public_url || !/^https:\/\//i.test(asset.public_url)) return [];
    const metadata = mediaMetadata(asset);
    if (!metadata.tags.map((tag) => tag.toLowerCase()).includes(artistTag)) return [];
    const evidenceRelationship = relationship(asset);
    if (!evidenceRelationship) return [];
    return [{
      assetId: asset.id,
      url: asset.public_url,
      title: metadata.title,
      relationship: evidenceRelationship,
    }];
  });
}

function canonicalIds(analysis: Awaited<ReturnType<typeof analyzeVisualBrandEvidence>>["analysis"], fallback: VisualBrandEvidence[]) {
  const core = analysis.clusters.filter((cluster) => cluster.role === "core").flatMap((cluster) => cluster.assetIds);
  const sourceIds = new Set(fallback.map((item) => item.assetId));
  const valid = Array.from(new Set(core)).filter((id) => sourceIds.has(id)).slice(0, 8);
  return valid.length >= 3 ? valid : fallback.filter((item) => item.relationship === "official").map((item) => item.assetId).slice(0, 8);
}

async function context(form: FormData) {
  const requestedArtistId = value(form, "artist_id") || undefined;
  const artist = await requireArtistContext(requestedArtistId);
  const { supabase, user } = await requireStudioAdmin();
  if (artist.userId !== user.id) throw new Error("Visual Brand DNA must be created from the active artist workspace.");
  return { artist, supabase, user, db: visualDb(supabase) };
}

export async function buildVisualBrandDraft(form: FormData) {
  const { artist, supabase, user, db } = await context(form);
  const maturity = maturitySchema.parse(value(form, "maturity") || "emerging");
  const parsedUseCases = form.getAll("use_case").map(String).filter(Boolean).map((item) => useCaseSchema.parse(item));
  const useCases = parsedUseCases.length ? parsedUseCases : ["release_artwork", "social", "video"];

  const { data: rawAssets, error: assetError } = await supabase
    .from("media_assets")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (assetError) throw new Error(assetError.message);
  const evidence = artistEvidence((rawAssets ?? []) as MediaAsset[], artist.artistId);
  if (evidence.length < 3) throw new Error("Add at least three image references to this artist before building Visual Brand DNA.");

  const synthesis = await analyzeVisualBrandEvidence({
    artistName: artist.artistName,
    evidence,
    maturity,
    useCases,
  });
  const { data: latest, error: versionError } = await db
    .from("artist_visual_brand_versions")
    .select("version")
    .eq("artist_id", artist.artistId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw new Error(versionError.message);
  const version = (latest?.version ?? 0) + 1;
  const canonical = canonicalIds(synthesis.analysis, synthesis.evidence);
  const analysis = {
    ...synthesis.analysis,
    synthesis: { model: synthesis.model, requestId: synthesis.requestId },
  } as unknown as Json;
  const { data: draft, error: insertError } = await db
    .from("artist_visual_brand_versions")
    .insert({
      owner_id: user.id,
      artist_id: artist.artistId,
      version,
      status: "draft",
      maturity,
      use_cases: useCases,
      source_asset_ids: synthesis.evidence.map((item) => item.assetId),
      canonical_asset_ids: canonical,
      dna: synthesis.dna as unknown as Json,
      analysis,
      confidence: synthesis.dna.fieldConfidence.overall,
    })
    .select("id,version")
    .single();
  if (insertError || !draft) throw new Error(insertError?.message || "Visual Brand DNA draft could not be saved.");
  revalidatePath("/studio/settings/brand/visual");
  revalidatePath("/studio/settings/brand");
  revalidatePath("/studio/brand");
  return { versionId: draft.id, version: draft.version };
}

export async function saveVisualBrandCalibration(form: FormData) {
  const { artist, db } = await context(form);
  const id = z.string().uuid().parse(value(form, "version_id"));
  const { data, error } = await db.from("artist_visual_brand_versions")
    .select("*")
    .eq("id", id)
    .eq("artist_id", artist.artistId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only the active artist's draft Visual Brand DNA can be calibrated.");
  const row = data as VisualBrandVersionRow;
  const dna = parseVisualBrandDna(row.dna);
  if (!dna) throw new Error("This Visual Brand DNA draft is invalid. Rebuild it from the evidence set.");

  const thesis = z.string().trim().min(12).max(600).parse(value(form, "thesis") || dna.thesis);
  const creativeFreedom = z.coerce.number().min(0).max(100).parse(value(form, "creative_freedom") || Math.round(dna.creativeFreedom * 100)) / 100;
  const humanUsage = humanUsageSchema.parse(value(form, "human_usage") || dna.humanRepresentation.usage);
  const antiStyle = value(form, "anti_style")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 16);
  const requestedCanonical = form.getAll("canonical_asset_id").map(String).filter((id) => row.source_asset_ids.includes(id));
  const nextDna = {
    ...dna,
    thesis,
    creativeFreedom,
    humanRepresentation: { ...dna.humanRepresentation, usage: humanUsage },
    antiStyle: antiStyle.length ? antiStyle : dna.antiStyle,
  };
  const { error: updateError } = await db.from("artist_visual_brand_versions").update({
    dna: nextDna as unknown as Json,
    canonical_asset_ids: requestedCanonical.length >= 3 ? Array.from(new Set(requestedCanonical)).slice(0, 8) : row.canonical_asset_ids,
  }).eq("id", id).eq("artist_id", artist.artistId).eq("status", "draft");
  if (updateError) throw new Error(updateError.message);
  revalidatePath("/studio/settings/brand/visual");
}

async function upsertDerivedSetting(input: {
  operational: ReturnType<typeof asArtistScopedOperationalClient>;
  ownerId: string;
  artistId: string;
  section: string;
  text: string;
}) {
  const { data: existing, error: lookupError } = await input.operational.from("brand_settings")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("section", input.section)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  const content = { text: input.text, derived_from: "visual-brand-dna-v1" } as Json;
  const mutation = existing
    ? input.operational.from("brand_settings").update({ content }).eq("id", existing.id).eq("artist_id", input.artistId)
    : input.operational.from("brand_settings").insert({ owner_id: input.ownerId, artist_id: input.artistId, section: input.section, content });
  const { error } = await mutation;
  if (error) throw new Error(error.message);
}

export async function activateVisualBrandVersion(form: FormData) {
  const { artist, supabase, user, db } = await context(form);
  const id = z.string().uuid().parse(value(form, "version_id"));
  const { data, error } = await db.from("artist_visual_brand_versions")
    .select("*")
    .eq("id", id)
    .eq("artist_id", artist.artistId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Visual Brand DNA draft was not found for this artist.");
  const row = data as VisualBrandVersionRow;
  const dna = parseVisualBrandDna(row.dna);
  if (!dna) throw new Error("This Visual Brand DNA draft is invalid and cannot be activated.");

  const { error: archiveError } = await db.from("artist_visual_brand_versions")
    .update({ status: "archived" })
    .eq("artist_id", artist.artistId)
    .eq("status", "active");
  if (archiveError) throw new Error(archiveError.message);
  const { error: activateError } = await db.from("artist_visual_brand_versions")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("artist_id", artist.artistId)
    .eq("status", "draft");
  if (activateError) throw new Error(activateError.message);

  const promptContext = toVisualBrandPromptContext(dna);
  const operational = asArtistScopedOperationalClient(supabase);
  await Promise.all([
    upsertDerivedSetting({ operational, ownerId: user.id, artistId: artist.artistId, section: "Visual world", text: dna.thesis }),
    upsertDerivedSetting({ operational, ownerId: user.id, artistId: artist.artistId, section: "Visual exclusions", text: dna.antiStyle.join("; ") }),
    upsertDerivedSetting({ operational, ownerId: user.id, artistId: artist.artistId, section: "Visual continuity rules", text: dna.continuityRules.join("; ") }),
    upsertDerivedSetting({ operational, ownerId: user.id, artistId: artist.artistId, section: "Visual prompt templates", text: formatVisualBrandPrompt(promptContext) }),
  ]);

  revalidatePath("/studio/settings/brand/visual");
  revalidatePath("/studio/settings/brand");
  revalidatePath("/studio/brand");
  revalidatePath("/studio/create");
}
