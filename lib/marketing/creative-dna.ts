import "server-only";

import { createMarketingServiceClient } from "./db";
import type { Json } from "@/types/database";
import type { CreativeReferenceContext } from "./creative-context";

export type ArtistCreativeDna = {
  version: "artist-creative-dna-v2";
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
  explicitFeedback: Array<{
    reason: string;
    note: string;
    hookText: string;
    contentAngle: string;
  }>;
  evidenceSummary: string;
};

export type AtlasCreativeDna = ArtistCreativeDna;

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
    ? visualQuality.issues.map((issue) => text(record(issue).detail)).filter(Boolean).slice(0, 3)
    : [];
  return issues.join(" ") || "Human visual review rejected this treatment/output combination.";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function feedbackAntiPattern(reason: string) {
  if (reason === "not_me") return "creative directions explicitly marked by the artist as not feeling like them";
  if (reason === "generic") return "generic concepts that could belong to any artist";
  if (reason === "visual_mismatch") return "visual treatments that drift outside the artist's established world";
  if (reason === "music_mismatch") return "visual or edit concepts attached to the wrong musical moment or audio treatment";
  if (reason === "too_promotional") return "ad-like promotional framing, fake urgency and campaign-sounding copy";
  if (reason === "duplicate") return "semantic repeats of previously used artist content";
  return "creative patterns the artist explicitly rejected";
}

export async function loadArtistCreativeDna(input: {
  ownerId: string;
  artistId: string;
  context: CreativeReferenceContext;
}): Promise<ArtistCreativeDna> {
  if (input.context.artistId !== input.artistId) {
    throw new Error("Creative reference context does not match the requested artist.");
  }
  const client = createMarketingServiceClient();
  const [runsResult, feedbackResult] = await Promise.all([
    client.from("generation_runs")
      .select("input_context,output,user_outcome,created_at")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .like("purpose", "content_asset:%")
      .in("user_outcome", ["accepted", "rejected"])
      .order("created_at", { ascending: false })
      .limit(30),
    client.from("marketing_events")
      .select("payload,occurred_at")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("event_type", "content.variant_rejected")
      .order("occurred_at", { ascending: false })
      .limit(30),
  ]);
  if (runsResult.error) throw new Error(runsResult.error.message);
  if (feedbackResult.error) throw new Error(feedbackResult.error.message);

  const approvedPatterns: ArtistCreativeDna["approvedPatterns"] = [];
  const rejectedPatterns: ArtistCreativeDna["rejectedPatterns"] = [];
  for (const run of runsResult.data ?? []) {
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

  const explicitFeedback: ArtistCreativeDna["explicitFeedback"] = [];
  for (const event of feedbackResult.data ?? []) {
    const payload = record(event.payload);
    const reason = text(payload.reason);
    const note = text(payload.note) || text(payload.notes);
    const hookText = text(payload.hookText);
    const contentAngle = text(payload.contentAngle);
    if (!reason && !note) continue;
    explicitFeedback.push({ reason, note, hookText, contentAngle });
    if (explicitFeedback.length >= 12) break;
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
    ...explicitFeedback.map((feedback) => feedbackAntiPattern(feedback.reason)),
    ...explicitFeedback.map((feedback) => feedback.note),
  ]);

  const evidenceCount = approvedPatterns.length + rejectedPatterns.length + explicitFeedback.length;
  return {
    version: "artist-creative-dna-v2",
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
    explicitFeedback,
    evidenceSummary: evidenceCount
      ? `${approvedPatterns.length} accepted outputs, ${rejectedPatterns.length} rejected outputs and ${explicitFeedback.length} explicit artist feedback signal${explicitFeedback.length === 1 ? "" : "s"} are available as artist-local Creative DNA evidence.`
      : "No reviewed creative history for this artist yet; use the explicit brand world, release identity and artist-specific approved reference assets as the source of truth.",
  };
}

export const loadAtlasCreativeDna = loadArtistCreativeDna;
