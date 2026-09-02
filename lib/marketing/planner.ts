import "server-only";

import { requireStudioAdmin } from "@/lib/auth/studio";
import { asSocialClient } from "@/lib/studio/social-db";
import type { Release } from "@/types/database";
import { generateStructured, marketingAiConfigured } from "./ai";
import { OBJECTIVE_KPIS, type MarketingObjective } from "./domain";
import {
  daysSinceRelease,
  lifecyclePlanningPrinciple,
  relativeDayForFutureOffset,
  releaseLifecycle,
} from "./release-lifecycle";
import {
  plannerPlatformsFromConnections,
  type CampaignSocialPlatform,
} from "./social-platforms";

export type CampaignPlanVariant = {
  label: string;
  hookText: string;
  caption: string;
  cta: string;
  visualPrompt: string;
  productionNotes: string;
};

export type CampaignPlanExperiment = {
  title: string;
  hypothesis: string;
  goal: MarketingObjective;
  primaryMetric: string;
  phaseCode: string;
  contentAngle: string;
  audienceSegment: string;
  variants: CampaignPlanVariant[];
};

export type CampaignContentMoment = {
  title: string;
  platform: CampaignSocialPlatform;
  format: string;
  goal: MarketingObjective;
  phaseCode: string;
  relativeDay: number;
  audienceSegment: string;
  contentAngle: string;
  experimentTitle: string;
};

export type CampaignPlan = {
  strategySummary: string;
  audienceSegments: string[];
  contentPillars: string[];
  experiments: CampaignPlanExperiment[];
  contentMoments: CampaignContentMoment[];
  learningsApplied: string[];
};

export type CampaignPlanningContext = {
  release: Pick<Release,
    | "id"
    | "title"
    | "release_type"
    | "release_date"
    | "story"
    | "core_emotion"
    | "audience"
    | "primary_hook"
    | "visual_direction"
    | "genre"
    | "subgenre"
    | "release_identity"
  >;
  objective: MarketingObjective;
  brandContext: string[];
  approvedLearnings: string[];
  connectedPlatforms?: CampaignSocialPlatform[];
  performanceSummary: Array<{
    title: string;
    platform: string;
    format: string;
    goal: string;
    score: number;
    signal: string;
  }>;
};

type ResolvedCampaignPlanningContext = Omit<CampaignPlanningContext, "connectedPlatforms"> & {
  connectedPlatforms: CampaignSocialPlatform[];
};

const OBJECTIVES = [
  "Reach",
  "Profile Visits",
  "Saves",
  "Follows",
  "Streams",
  "Community",
  "DJ Discovery",
  "Curator Discovery",
] as const;
const PHASES = ["discovery", "hook-test", "anticipation", "launch", "momentum", "revival"] as const;

function campaignPlanSchema(connectedPlatforms: CampaignSocialPlatform[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["strategySummary", "audienceSegments", "contentPillars", "experiments", "contentMoments", "learningsApplied"],
    properties: {
      strategySummary: { type: "string" },
      audienceSegments: { type: "array", items: { type: "string" } },
      contentPillars: { type: "array", items: { type: "string" } },
      experiments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "hypothesis", "goal", "primaryMetric", "phaseCode", "contentAngle", "audienceSegment", "variants"],
          properties: {
            title: { type: "string" },
            hypothesis: { type: "string" },
            goal: { type: "string", enum: OBJECTIVES },
            primaryMetric: { type: "string" },
            phaseCode: { type: "string", enum: PHASES },
            contentAngle: { type: "string" },
            audienceSegment: { type: "string" },
            variants: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "hookText", "caption", "cta", "visualPrompt", "productionNotes"],
                properties: {
                  label: { type: "string" },
                  hookText: { type: "string" },
                  caption: { type: "string" },
                  cta: { type: "string" },
                  visualPrompt: { type: "string" },
                  productionNotes: { type: "string" },
                },
              },
            },
          },
        },
      },
      contentMoments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "platform", "format", "goal", "phaseCode", "relativeDay", "audienceSegment", "contentAngle", "experimentTitle"],
          properties: {
            title: { type: "string" },
            platform: { type: "string", enum: connectedPlatforms },
            format: { type: "string" },
            goal: { type: "string", enum: OBJECTIVES },
            phaseCode: { type: "string", enum: PHASES },
            // Historical catalog releases can legitimately be hundreds of days past T0. The
            // lifecycle gate below, not an arbitrary 45-day schema ceiling, decides what is actionable.
            relativeDay: { type: "integer", minimum: -21, maximum: 3650 },
            audienceSegment: { type: "string" },
            contentAngle: { type: "string" },
            experimentTitle: { type: "string" },
          },
        },
      },
      learningsApplied: { type: "array", items: { type: "string" } },
    },
  };
}

const PLANNER_INSTRUCTIONS = `You are the campaign strategist inside Atlas Irwin Studio.
Atlas Irwin is an independent electronic artist. Build a testable, artist-specific campaign, not a generic social media checklist.

Rules:
- The input contains connectedSocialChannels. These are a hard capability boundary. Create content moments ONLY for those exact platforms. Never suggest, reserve, repurpose to, or mention posting on an unavailable social channel.
- The input contains releaseLifecycle, lifecyclePlanningPrinciple and minimumActionableRelativeDay. They are hard temporal boundaries. NEVER create a content moment before minimumActionableRelativeDay. Never recreate missed pre-release activity for music that is already live.
- When releaseLifecycle is launch_window or catalog, speak and plan as if the music is already available. Do not write fake teasers, countdowns, pre-save language or "coming soon" copy.
- If only one social channel is connected, create a coherent campaign for that one channel instead of inventing channel diversity.
- Every creative idea must come from the supplied release identity, sonic hook, emotion, visual world, story, or explicitly supplied historical evidence.
- Treat historical learnings as evidence only when they are explicitly supplied. Never invent performance claims.
- Each experiment tests one clear hypothesis and has 2 or 3 meaningfully different variants.
- Every experiment must be attached to exactly one content moment. Do not reuse the same experimentTitle across multiple platforms or posting times. Cross-platform repurposing happens only after a winner is found and only when that destination platform is connected.
- Variants should differ in the first-second hook, framing, or audience promise, not just punctuation.
- Keep captions concise, human, specific, and compatible with an artist voice. Avoid marketing jargon, fake urgency, generic AI language, and repetitive "out now" posts.
- Use platform-native formats but keep one coherent campaign world.
- Prefer a small number of strong experiments over content volume.
- Use release-relative timing. Day 0 is the release date, even for live catalog; current-day work may therefore have a large positive relativeDay.
- Include at least one DJ/selector or curator discovery angle when it fits the release.
- The goal is to learn what moves the right listeners toward saves, follows, smart-link clicks, streams, playlist adds, and genuine community signals.`;

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function nativeFormat(platform: CampaignSocialPlatform) {
  if (platform === "Instagram") return "Reel";
  if (platform === "TikTok") return "TikTok video";
  return "Short";
}

function minimumActionableRelativeDay(releaseDate: string | null | undefined) {
  if (!releaseDate) return null;
  const relativeToday = daysSinceRelease(releaseDate) ?? 0;
  return Math.max(-21, relativeToday + 1);
}

async function resolvePlanningContext(
  context: CampaignPlanningContext,
): Promise<ResolvedCampaignPlanningContext> {
  if (context.connectedPlatforms !== undefined) {
    return { ...context, connectedPlatforms: context.connectedPlatforms };
  }

  const { supabase, user } = await requireStudioAdmin();
  const { data, error } = await asSocialClient(supabase)
    .from("social_channel_accounts")
    .select("platform,status")
    .eq("owner_id", user.id)
    .eq("status", "connected");
  if (error) {
    console.error("Unable to resolve connected campaign channels:", error.message);
    return { ...context, connectedPlatforms: [] };
  }
  return {
    ...context,
    connectedPlatforms: plannerPlatformsFromConnections(data ?? []),
  };
}

function normalizeCampaignPlan(
  plan: CampaignPlan,
  connectedPlatforms: CampaignSocialPlatform[],
  minimumRelativeDay: number | null,
): CampaignPlan {
  const allowedPlatforms = new Set<string>(connectedPlatforms);
  const uniqueExperiments = Array.from(
    new Map(
      plan.experiments
        .filter((experiment) => experiment.title.trim())
        .map((experiment) => [experiment.title.trim(), experiment]),
    ).values(),
  ).map((experiment) => ({
    ...experiment,
    title: experiment.title.trim(),
    primaryMetric: OBJECTIVE_KPIS[experiment.goal].primary,
    variants: experiment.variants.slice(0, 3).map((variant, index) => ({
      ...variant,
      label: String.fromCharCode(65 + index),
    })),
  }));

  const experimentByTitle = new Map(uniqueExperiments.map((experiment) => [experiment.title, experiment]));
  const claimed = new Set<string>();
  const contentMoments = plan.contentMoments
    .filter((moment) => allowedPlatforms.has(moment.platform))
    .filter((moment) => minimumRelativeDay === null || moment.relativeDay >= minimumRelativeDay)
    .map((moment) => {
      const requestedTitle = moment.experimentTitle.trim();
      const experiment = requestedTitle ? experimentByTitle.get(requestedTitle) : undefined;
      if (!experiment || claimed.has(experiment.title)) {
        return { ...moment, experimentTitle: "" };
      }
      claimed.add(experiment.title);
      return {
        ...moment,
        experimentTitle: experiment.title,
        goal: experiment.goal,
        phaseCode: experiment.phaseCode,
        contentAngle: experiment.contentAngle,
        audienceSegment: experiment.audienceSegment,
      };
    });

  return {
    ...plan,
    experiments: uniqueExperiments.filter((experiment) => claimed.has(experiment.title)),
    contentMoments,
  };
}

function noTimingPlan(context: ResolvedCampaignPlanningContext): CampaignPlan {
  const title = context.release.title;
  const audience = firstNonEmpty(context.release.audience, "independent electronic and nu-disco listeners");
  return {
    strategySummary: `${title} has enough identity context to prepare strategy, but Atlas will not manufacture calendar dates until the release has an anchor date.`,
    audienceSegments: [audience, "DJs and selectors who program warm electronic music"],
    contentPillars: ["musical payoff", "world and mood", "selector utility", "human process"],
    learningsApplied: context.approvedLearnings.slice(0, 4),
    experiments: [],
    contentMoments: [],
  };
}

function liveFallbackPlan(context: ResolvedCampaignPlanningContext): CampaignPlan {
  const release = context.release;
  if (!release.release_date) return noTimingPlan(context);
  const title = release.title;
  const emotion = firstNonEmpty(release.core_emotion, "late-night connection");
  const sonicHook = firstNonEmpty(release.primary_hook, "the strongest musical turn in the track");
  const visual = firstNonEmpty(release.visual_direction, "warm analog light, motion and tactile electronic detail");
  const audience = firstNonEmpty(release.audience, "independent electronic and nu-disco listeners");
  const learned = context.approvedLearnings.slice(0, 4);
  const primary = context.connectedPlatforms[0];
  if (!primary) {
    return {
      strategySummary: `${title} is already live. Atlas has a rediscovery thesis, but no posting moments were created because no social channels are connected in Studio Settings.`,
      audienceSegments: [audience, "DJs and selectors who program warm electronic music"],
      contentPillars: ["rediscovery", "musical detail", "song meaning", "selector utility"],
      learningsApplied: learned,
      experiments: [],
      contentMoments: [],
    };
  }
  const second = context.connectedPlatforms[1] ?? primary;
  const phase = releaseLifecycle({ releaseDate: release.release_date }) === "catalog" ? "revival" : "momentum";
  const relative = (offset: number) => relativeDayForFutureOffset(release.release_date!, offset);
  return normalizeCampaignPlan({
    strategySummary: `${title} is live. Start from current-day rediscovery, use ${sonicHook} as the musical proof, and learn which specific angle turns renewed attention into durable listener intent. Missed launch activity is intentionally ignored.`,
    audienceSegments: [audience, "DJs and selectors who program warm electronic music", "listeners discovering Atlas Irwin after release day"],
    contentPillars: ["rediscovery", "musical detail", "song meaning", "selector utility"],
    learningsApplied: learned,
    experiments: [
      {
        title: "Current rediscovery framing",
        hypothesis: `A direct current-day entry into ${sonicHook} will create stronger music intent than pretending ${title} is a new launch.`,
        goal: context.objective,
        primaryMetric: OBJECTIVE_KPIS[context.objective].primary,
        phaseCode: phase,
        contentAngle: "current rediscovery",
        audienceSegment: audience,
        variants: [
          {
            label: "A",
            hookText: `If you missed ${title}, start here.`,
            caption: `${title} has been out. This is still the part I would use to introduce it today.`,
            cta: "Hear the full track.",
            visualPrompt: `Current-day vertical rediscovery visual tied to ${visual}. Open on the strongest musical payoff; no countdown, launch badge, fake crowd, generic cyberpunk or "coming soon" language.`,
            productionNotes: "Use Track Intelligence or the strongest matching Audio Scene. Treat the track as available now.",
          },
          {
            label: "B",
            hookText: `One detail inside ${title} that keeps pulling me back.`,
            caption: `${title}, from the inside out.`,
            cta: "Save it if this detail gets you.",
            visualPrompt: `Tactile vertical detail study derived from ${visual}; make the musical layer feel physically visible without fake waveform decoration.`,
            productionNotes: "Prefer Stem Intelligence or a progressive reveal Audio Scene. One concrete musical detail, no generic BTS copy.",
          },
        ],
      },
      {
        title: "Live selector utility",
        hypothesis: `Showing how ${title} functions as a selector record will create higher-quality saves and shares than generic artist promotion.`,
        goal: "DJ Discovery",
        primaryMetric: OBJECTIVE_KPIS["DJ Discovery"].primary,
        phaseCode: phase,
        contentAngle: "selector utility",
        audienceSegment: "DJs and selectors who program warm electronic music",
        variants: [
          {
            label: "A",
            hookText: "For selectors who need movement without more noise.",
            caption: `${title}. Warm low end, room to mix, and the payoff is in the movement.`,
            cta: "DJ or selector? Keep it for a set.",
            visualPrompt: `Restrained DJ-oriented vertical visual for ${title}, derived from ${visual}. Tactile controls and groove-led motion, no fake crowd footage.`,
            productionNotes: "Use a groove-led Audio Scene or the most mix-friendly Track Intelligence window.",
          },
          {
            label: "B",
            hookText: "A transition record for when the room needs more body, not more noise.",
            caption: `${title} was built for that point in the night.`,
            cta: "Send this to a selector who would use it.",
            visualPrompt: `Minimal 9:16 club-tool visual derived from ${visual}; physical rhythm, restrained typography, no festival tropes.`,
            productionNotes: "Let the groove prove the claim. Keep it specific and current, never launch-coded.",
          },
        ],
      },
    ],
    contentMoments: [
      { title: `${title}: current rediscovery`, platform: primary, format: nativeFormat(primary), goal: context.objective, phaseCode: phase, relativeDay: relative(1), audienceSegment: audience, contentAngle: "current rediscovery", experimentTitle: "Current rediscovery framing" },
      { title: `${title}: musical detail`, platform: second, format: nativeFormat(second), goal: "Saves", phaseCode: phase, relativeDay: relative(5), audienceSegment: audience, contentAngle: "inside the track", experimentTitle: "" },
      { title: `${title}: meaning angle`, platform: primary, format: nativeFormat(primary), goal: "Follows", phaseCode: phase, relativeDay: relative(9), audienceSegment: audience, contentAngle: emotion, experimentTitle: "" },
      { title: `${title}: selector utility`, platform: second, format: nativeFormat(second), goal: "DJ Discovery", phaseCode: phase, relativeDay: relative(14), audienceSegment: "DJs and selectors who program warm electronic music", contentAngle: "selector utility", experimentTitle: "Live selector utility" },
    ],
  }, context.connectedPlatforms, minimumActionableRelativeDay(release.release_date));
}

function fallbackPlan(context: ResolvedCampaignPlanningContext): CampaignPlan {
  const release = context.release;
  if (!release.release_date) return noTimingPlan(context);
  const lifecycle = releaseLifecycle({ releaseDate: release.release_date });
  if (lifecycle === "launch_window" || lifecycle === "catalog") return liveFallbackPlan(context);

  const title = release.title;
  const emotion = firstNonEmpty(release.core_emotion, "late-night connection");
  const sonicHook = firstNonEmpty(release.primary_hook, "the strongest musical turn in the track");
  const visual = firstNonEmpty(release.visual_direction, "warm analog light, motion and tactile electronic detail");
  const audience = firstNonEmpty(release.audience, "independent electronic and nu-disco listeners");
  const primaryKpi = OBJECTIVE_KPIS[context.objective].primary;
  const learned = context.approvedLearnings.slice(0, 4);
  const primary = context.connectedPlatforms[0];

  if (!primary) {
    return {
      strategySummary: `${title} has a campaign strategy ready, but no social posting moments were created because no social channels are connected in Studio Settings.`,
      audienceSegments: [audience, "DJs and selectors who program warm electronic music"],
      contentPillars: ["musical payoff", "world and mood", "selector utility", "human process"],
      learningsApplied: learned,
      experiments: [],
      contentMoments: [],
    };
  }

  const second = context.connectedPlatforms[1] ?? primary;
  const third = context.connectedPlatforms[2] ?? second;
  return normalizeCampaignPlan({
    strategySummary: `${title} should be marketed through the tension between ${emotion} and ${sonicHook}. Test the musical payoff before scaling reach, then move winning framing into release-day conversion and post-release discovery across the connected channel set.`,
    audienceSegments: [audience, "DJs and selectors who program warm electronic music", "listeners who discover music through visual mood and short-form hooks"],
    contentPillars: ["musical payoff", "world and mood", "selector utility", "human process"],
    learningsApplied: learned,
    experiments: [
      {
        title: "Sonic payoff framing",
        hypothesis: `Opening directly on ${sonicHook} with a concrete situational frame will create stronger intent than an abstract mood intro.`,
        goal: context.objective,
        primaryMetric: primaryKpi,
        phaseCode: "hook-test",
        contentAngle: "musical payoff",
        audienceSegment: audience,
        variants: [
          {
            label: "A",
            hookText: `The moment ${title} finally opens up.`,
            caption: `${title}. Built around ${sonicHook}.`,
            cta: context.objective === "Streams" ? "Hear the full track through the link." : "Save this if this is your kind of second wind.",
            visualPrompt: `Vertical 9:16 visual tied to ${visual}. Start with immediate motion and make the strongest musical moment feel physically synchronized to the image. No generic cyberpunk imagery, no stock characters.`,
            productionNotes: `Open on the payoff within the first 0.5 seconds. Adapt the cut natively for ${primary}.`,
          },
          {
            label: "B",
            hookText: "Berlin, late enough that the bass becomes the plan.",
            caption: `${title} lives somewhere between ${emotion} and a room that does not want to go home yet.`,
            cta: "Keep it for later tonight.",
            visualPrompt: `Vertical 9:16 after-hours scene derived from ${visual}, tactile and warm rather than neon-cyberpunk. Build a visual reveal around ${sonicHook}.`,
            productionNotes: "Situational text appears immediately, then disappears before the musical payoff. 10 to 14 seconds.",
          },
          {
            label: "C",
            hookText: `No setup. Just ${sonicHook}.`,
            caption: `${title}.`,
            cta: "Turn it up.",
            visualPrompt: `Minimal vertical music visual using ${visual}. One strong repeated visual motif, no narrative clutter, precise beat-linked movement.`,
            productionNotes: "Control variant. Minimal copy. Same audio window as A and B so framing is the main variable.",
          },
        ],
      },
      {
        title: "Selector utility",
        hypothesis: `Framing ${title} as a useful DJ moment will generate higher-quality saves and shares among selectors than a general listener message.`,
        goal: "DJ Discovery",
        primaryMetric: OBJECTIVE_KPIS["DJ Discovery"].primary,
        phaseCode: "momentum",
        contentAngle: "selector utility",
        audienceSegment: "DJs and selectors who program warm electronic music",
        variants: [
          {
            label: "A",
            hookText: "For the selectors who need a second-wind record.",
            caption: `${title}. Warm low end, room to mix, and the payoff is in the movement rather than a giant drop.`,
            cta: "DJ/selector? Save it for the next set.",
            visualPrompt: `Vertical DJ-oriented clip for ${title}, focused on waveform-like motion, tactile controls, shadows and ${visual}. No fake crowd footage.`,
            productionNotes: "Use a mix-friendly section and show the exact audio timestamp in production notes.",
          },
          {
            label: "B",
            hookText: "A transition record for when the room needs more body, not more noise.",
            caption: `${title} was built for that point in the night.`,
            cta: "Send this to a selector who would use it.",
            visualPrompt: `Restrained 9:16 club-tool visual derived from ${visual}; physical rhythm, minimal text, no festival tropes.`,
            productionNotes: "Keep it 12 to 16 seconds and let the groove prove the claim.",
          },
        ],
      },
    ],
    contentMoments: [
      { title: `${title}: world signal`, platform: primary, format: nativeFormat(primary), goal: "Reach", phaseCode: "discovery", relativeDay: -14, audienceSegment: audience, contentAngle: "world and mood", experimentTitle: "" },
      { title: `${title}: hook test`, platform: primary, format: nativeFormat(primary), goal: context.objective, phaseCode: "hook-test", relativeDay: -7, audienceSegment: audience, contentAngle: "musical payoff", experimentTitle: "Sonic payoff framing" },
      { title: `${title}: hook winner replication slot`, platform: second, format: nativeFormat(second), goal: context.objective, phaseCode: "hook-test", relativeDay: -5, audienceSegment: audience, contentAngle: "reserved for a proven framing or a non-experimental platform-native cut", experimentTitle: "" },
      { title: `${title}: release-day conversion`, platform: primary, format: nativeFormat(primary), goal: "Streams", phaseCode: "launch", relativeDay: 0, audienceSegment: audience, contentAngle: "winning hook plus full-track promise", experimentTitle: "" },
      { title: `${title}: selector clip`, platform: primary, format: nativeFormat(primary), goal: "DJ Discovery", phaseCode: "momentum", relativeDay: 5, audienceSegment: "DJs and selectors who program warm electronic music", contentAngle: "selector utility", experimentTitle: "Selector utility" },
      { title: `${title}: process detail`, platform: third, format: nativeFormat(third), goal: "Follows", phaseCode: "momentum", relativeDay: 9, audienceSegment: audience, contentAngle: "human process", experimentTitle: "" },
      { title: `${title}: catalog re-entry`, platform: second, format: nativeFormat(second), goal: "Streams", phaseCode: "revival", relativeDay: 28, audienceSegment: audience, contentAngle: "rediscovery through a different musical detail", experimentTitle: "" },
    ],
  }, context.connectedPlatforms, minimumActionableRelativeDay(release.release_date));
}

export async function planCampaign(inputContext: CampaignPlanningContext) {
  const context = await resolvePlanningContext(inputContext);
  const lifecycle = releaseLifecycle({ releaseDate: context.release.release_date });
  const minimumRelativeDay = minimumActionableRelativeDay(context.release.release_date);
  if (!context.connectedPlatforms.length || !context.release.release_date || !marketingAiConfigured()) {
    return {
      plan: fallbackPlan(context),
      generation: { provider: "template", model: "adaptive-fallback", requestId: null },
    } as const;
  }

  const input = JSON.stringify({
    release: context.release,
    releaseLifecycle: lifecycle,
    lifecyclePlanningPrinciple: lifecyclePlanningPrinciple(lifecycle),
    minimumActionableRelativeDay: minimumRelativeDay,
    objective: context.objective,
    connectedSocialChannels: context.connectedPlatforms,
    brandContext: context.brandContext,
    approvedLearnings: context.approvedLearnings,
    performanceSummary: context.performanceSummary,
  }, null, 2);
  try {
    const generated = await generateStructured<CampaignPlan>({
      name: "atlas_campaign_plan",
      schema: campaignPlanSchema(context.connectedPlatforms) as unknown as Record<string, unknown>,
      instructions: PLANNER_INSTRUCTIONS,
      input,
    });
    const normalized = normalizeCampaignPlan(generated.value, context.connectedPlatforms, minimumRelativeDay);
    return {
      // If a model ignored the hard temporal rule so completely that no actionable moments survived,
      // fall back to a deterministic lifecycle-safe plan instead of saving an empty or historical plan.
      plan: normalized.contentMoments.length ? normalized : fallbackPlan(context),
      generation: generated,
    } as const;
  } catch (error) {
    return {
      plan: fallbackPlan(context),
      generation: {
        provider: "template",
        model: "adaptive-fallback",
        requestId: null,
        fallbackReason: error instanceof Error ? error.message : "AI planning failed",
      },
    } as const;
  }
}
