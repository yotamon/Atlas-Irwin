import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { atlasAiGatewayConfigured } from "@/lib/ai/gateway";
import { runAtlasAiTask } from "@/lib/ai/control-plane";
import { strictQualityResult, type AtlasQualityGate } from "@/lib/ai/quality";
import type { AtlasAiTaskType } from "@/lib/ai/tasks";
import { conciseLyricsPromptContext, loadTrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import { conciseCreativeGraphContext } from "@/lib/music-intelligence/creative-graph";
import { loadTrackCreativeIntelligenceGraph } from "@/lib/music-intelligence/creative-graph-loader";
import type { LyricsDatabase } from "@/types/lyrics-database";

export type MarketingTextProvider = "vercel-gateway" | "openai" | "google" | "zai";
export type MarketingTextPreset = "economy" | "balanced" | "premium";

export type StructuredGenerationResult<T> = {
  value: T;
  provider: MarketingTextProvider;
  model: string;
  requestedModel?: string;
  requestId: string | null;
  estimatedCostUsd: number | null;
  generationId?: string | null;
  routedProvider?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  runId?: string | null;
  rootRunId?: string | null;
  escalated?: boolean;
  qualityScore?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function taskForName(name: string): AtlasAiTaskType {
  if (name === "atlas_campaign_plan") return "marketing.campaign_plan";
  if (name.includes("caption")) return "marketing.caption";
  return "marketing.strategy";
}

function parseInputContext(input: string) {
  try { return asRecord(JSON.parse(input)); }
  catch { return {};
  }
}

function releaseIdFromContext(context: Record<string, unknown>) {
  const release = asRecord(context.release);
  const content = asRecord(context.content);
  return stringValue(release.id)
    || stringValue(context.releaseId)
    || stringValue(context.release_id)
    || stringValue(content.releaseId)
    || stringValue(content.release_id)
    || null;
}

async function enrichMarketingContextWithLyrics({
  context,
  supabase,
  ownerId,
}: {
  context: Record<string, unknown>;
  supabase: SupabaseClient;
  ownerId: string;
}) {
  if ("lyricsIntelligence" in context && "trackCreativeIntelligence" in context) return context;
  const releaseId = releaseIdFromContext(context);
  if (!releaseId) return context;

  try {
    const { data: tracks, error } = await supabase
      .from("tracks")
      .select("id,is_primary")
      .eq("owner_id", ownerId)
      .eq("release_id", releaseId)
      .order("is_primary", { ascending: false });
    if (error) throw new Error(error.message);
    const primaryTrack = tracks?.[0];
    if (!primaryTrack?.id) return context;

    const lyrics = "lyricsIntelligence" in context
      ? null
      : await loadTrackLyricsContext(
          supabase as unknown as SupabaseClient<LyricsDatabase>,
          primaryTrack.id,
          ownerId,
        );
    const graph = "trackCreativeIntelligence" in context
      ? null
      : await loadTrackCreativeIntelligenceGraph(
          supabase,
          primaryTrack.id,
          ownerId,
          lyrics ?? undefined,
        );
    return {
      ...context,
      ...("lyricsIntelligence" in context ? {} : { lyricsIntelligence: conciseLyricsPromptContext(lyrics!) }),
      ...("trackCreativeIntelligence" in context ? {} : { trackCreativeIntelligence: conciseCreativeGraphContext(graph) }),
    };
  } catch (error) {
    // Creative intelligence is optional context. A migration/read problem must not prevent otherwise
    // valid campaign/caption work; it remains visible in server logs for repair.
    console.warn("Unable to enrich marketing AI with track creative intelligence:", error instanceof Error ? error.message : error);
    return context;
  }
}

function campaignQualityGate(input: string): AtlasQualityGate<unknown> {
  const context = parseInputContext(input);
  const connected = new Set(asArray(context.connectedSocialChannels).filter((item): item is string => typeof item === "string"));
  return (value) => {
    const plan = asRecord(value);
    const experiments = asArray(plan.experiments).map(asRecord);
    const moments = asArray(plan.contentMoments).map(asRecord);
    const experimentTitles = experiments.map((item) => stringValue(item.title)).filter(Boolean);
    const momentExperimentTitles = moments.map((item) => stringValue(item.experimentTitle)).filter(Boolean);
    const uniqueMomentKeys = new Set(moments.map((moment) => [
      stringValue(moment.platform),
      stringValue(moment.title),
      String(moment.relativeDay ?? ""),
    ].join("|")));
    const variantCountsValid = experiments.every((experiment) => {
      const variants = asArray(experiment.variants).map(asRecord);
      return variants.length >= 2 && variants.length <= 3 && variants.every((variant) =>
        stringValue(variant.hookText).length >= 3 && stringValue(variant.caption).length >= 3,
      );
    });
    const experimentReferencesValid = experimentTitles.every((title) =>
      momentExperimentTitles.filter((candidate) => candidate === title).length === 1,
    );
    const platformBoundaryValid = moments.every((moment) => connected.has(stringValue(moment.platform)));
    const minimumMoments = connected.size ? Math.min(7, Math.max(4, connected.size * 2)) : 0;

    return strictQualityResult([
      { passed: stringValue(plan.strategySummary).length >= 40, failure: "Campaign strategy summary is too thin." },
      { passed: moments.length >= minimumMoments, failure: `Campaign needs at least ${minimumMoments} useful content moments for the connected channel set.` },
      { passed: moments.length <= 16, failure: "Campaign contains too many content moments and is not focused enough." },
      { passed: uniqueMomentKeys.size === moments.length, failure: "Campaign contains duplicate posting moments." },
      { passed: platformBoundaryValid, failure: "Campaign suggested a disconnected social platform." },
      { passed: new Set(experimentTitles).size === experimentTitles.length, failure: "Campaign experiment titles are not unique." },
      { passed: variantCountsValid, failure: "Every experiment needs 2-3 usable, materially written variants." },
      { passed: experimentReferencesValid, failure: "Every experiment must be attached to exactly one content moment." },
    ]);
  };
}

function qualityGateFor<T>(name: string, input: string): AtlasQualityGate<T> | undefined {
  if (name === "atlas_campaign_plan") return campaignQualityGate(input) as AtlasQualityGate<T>;
  return undefined;
}

export function marketingAiConfigured() {
  return atlasAiGatewayConfigured();
}

export function marketingAiModel() {
  return process.env.ATLAS_MARKETING_MODEL?.trim() || "auto via Atlas AI Control Plane";
}

export async function generateStructured<T>({
  name,
  schema,
  instructions,
  input,
}: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
}): Promise<StructuredGenerationResult<T>> {
  if (!marketingAiConfigured()) {
    throw new Error(
      "Atlas marketing AI is not configured. Production uses Vercel OIDC automatically; set AI_GATEWAY_API_KEY for local development.",
    );
  }

  const { supabase, user } = await requireStudioAdmin();
  const parsedInputContext = parseInputContext(input);
  const inputContext = await enrichMarketingContextWithLyrics({
    context: parsedInputContext,
    supabase: supabase as unknown as SupabaseClient,
    ownerId: user.id,
  });
  const enrichedInput = JSON.stringify(inputContext, null, 2);
  const releaseId = releaseIdFromContext(inputContext);
  const result = await runAtlasAiTask<T>({
    ownerId: user.id,
    task: taskForName(name),
    purpose: name === "atlas_campaign_plan" ? "campaign_plan" : name,
    releaseId,
    promptVersion: name === "atlas_campaign_plan" ? "marketing-v4-creative-graph" : "marketing-control-v3-creative-graph",
    schema,
    instructions: `${instructions}\n\nTRACK CREATIVE INTELLIGENCE RULES:\nWhen trackCreativeIntelligence is present, treat it as the shared cross-modal timeline joining master-audio hooks, Lyrics Intelligence, active stem roles and Audio Scenes. Prefer highlights supported by multiple modalities. Respect supplied start/end timing and provenance. Do not infer that a lyric is sung merely because a music section has the same structural label. Use materially different highlights instead of repeatedly choosing near-identical chorus windows.\n\nLYRICS INTELLIGENCE RULES:\nWhen lyricsIntelligence is present, treat it as authoritative song-specific narrative context. It may inform hooks, captions, visual briefs and campaign angles. Quote only excerpts explicitly supplied with mayQuote=true. Never invent, complete, reconstruct or paraphrase text as if it were an official lyric. If quoting is disabled, use only semantic themes and meaning without reproducing lyric text.`,
    input: enrichedInput,
    inputContext,
    qualityGate: qualityGateFor<T>(name, enrichedInput),
  });

  return {
    value: result.value,
    provider: result.provider,
    model: result.model,
    requestedModel: result.requestedModel,
    requestId: result.requestId,
    estimatedCostUsd: result.estimatedCostUsd,
    generationId: result.generationId,
    routedProvider: result.routedProvider,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    runId: result.runId,
    rootRunId: result.rootRunId,
    escalated: result.escalated,
    qualityScore: result.quality.score,
  };
}
