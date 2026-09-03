import "server-only";

import { createMarketingServiceClient } from "./db";
import type { Json } from "@/types/database";
import type { CreativeReferenceContext } from "./creative-context";

export type AtlasCreativeDna = {
  version: "atlas-creative-dna-v1";
  identity: {
    visualWorld: string;
    continuityRules: string;
    visualExclusions: string;
    releasePalette: string[];
  };
  sourceHierarchy: string[];
  hardAntiPatterns: string[];
  approvedPatterns: Array<{
    concept: string;
    heroMotif: string;
    cameraLanguage: string;
    editingGrammar: string;
    sourceStrategy: string;
  }>;
  rejectedPatterns: Array<{
    concept: string;
    heroMotif: string;
    cameraLanguage: string;
    reason: string;
  }>;
  evidenceSummary: string;
};

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function treatmentFromRun(inputContext: Json | unknown) {
  return record(record(inputContext).treatment);
}

function rejectionReason(output: Json | unknown) {
  const result = record(output);
  const visualQuality = record(result.visualQuality);
  const issues = Array.isArray(visualQuality.issues)
    ? visualQuality.issues
        .map((issue) => text(record(issue).detail))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  return issues.join(" ") || "Human visual review rejected this treatment/output combination.";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function loadAtlasCreativeDna(input: {
  ownerId: string;
  artistId: string;
  context: CreativeReferenceContext;
}): Promise<AtlasCreativeDna> {
  if (input.context.artistId !== input.artistId) {
    throw new Error("Creative reference context does not match the requested artist.");
  }
  const client = createMarketingServiceClient();
  const { data, error } = await client.from("generation_runs")
    .select("input_context,output,user_outcome,created_at")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .like("purpose", "content_asset:%")
    .in("user_outcome", ["accepted", "rejected"])
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  const approvedPatterns: AtlasCreativeDna["approvedPatterns"] = [];
  const rejectedPatterns: AtlasCreativeDna["rejectedPatterns"] = [];
  for (const run of data ?? []) {
    const runContext = record(run.input_context);
    if (runContext.artistId !== input.artistId) continue;
    const treatment = treatmentFromRun(run.input_context);
    const concept = text(treatment.concept);
    if (!concept) continue;
    if (run.user_outcome === "accepted" && approvedPatterns.length < 8) {
      approvedPatterns.push({
        concept,
        heroMotif: text(treatment.heroMotif),
        cameraLanguage: text(treatment.cameraLanguage),
        editingGrammar: text(treatment.editingGrammar),
        sourceStrategy: text(treatment.sourceStrategy),
      });
    }
    if (run.user_outcome === "rejected" && rejectedPatterns.length < 8) {
      rejectedPatterns.push({
        concept,
        heroMotif: text(treatment.heroMotif),
        cameraLanguage: text(treatment.cameraLanguage),
        reason: rejectionReason(run.output),
      });
    }
  }

  const brandExclusions = input.context.brand.visualExclusions
    .split(/[\n;,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const hardAntiPatterns = uniqueStrings([
    ...brandExclusions,
    "generic cyberpunk and random neon city imagery",
    "chrome humanoids or anonymous glossy fashion models without an artist-specific reason",
    "fake festival or nightclub crowds generated as proof of popularity",
    "floating particles, meaningless holograms and generic sci-fi spectacle",
    "AI-rendered logos, captions, lyric typography, buttons or fake platform UI",
    "generic OUT NOW social templates and promotional urgency graphics",
  ]);

  return {
    version: "atlas-creative-dna-v1",
    identity: {
      visualWorld: input.context.brand.visualWorld,
      continuityRules: input.context.brand.continuityRules,
      visualExclusions: input.context.brand.visualExclusions,
      releasePalette: [...input.context.release.colorPalette],
    },
    sourceHierarchy: [
      "real artist footage and photography",
      "canonical release artwork and approved alternate artwork",
      "artist-tagged brand references and previous accepted creative for this artist only",
      "deterministic motion graphics and typography",
      "selective generated plates that extend the established world",
    ],
    hardAntiPatterns,
    approvedPatterns,
    rejectedPatterns,
    evidenceSummary: approvedPatterns.length || rejectedPatterns.length
      ? `${approvedPatterns.length} accepted and ${rejectedPatterns.length} rejected recent creative outcome${approvedPatterns.length + rejectedPatterns.length === 1 ? "" : "s"} for this artist are available as creative-direction evidence.`
      : "No reviewed creative history for this artist yet; use the explicit brand world, release identity and artist-specific approved reference assets as the source of truth.",
  };
}
