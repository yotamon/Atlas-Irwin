import "server-only";

import type { Release } from "@/types/database";
import { generateStructured, marketingAiConfigured } from "./ai";
import { OBJECTIVE_KPIS, type MarketingObjective } from "./domain";

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
  platform: string;
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
  performanceSummary: Array<{
    title: string;
    platform: string;
    format: string;
    goal: string;
    score: number;
    signal: string;
  }>;
};

const planSchema = {
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
          goal: { type: "string", enum: ["Reach", "Profile Visits", "Saves", "Follows", "Streams", "Community", "DJ Discovery", "Curator Discovery"] },
          primaryMetric: { type: "string" },
          phaseCode: { type: "string", enum: ["discovery", "hook-test", "anticipation", "launch", "momentum", "revival"] },
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
          platform: { type: "string", enum: ["Instagram", "TikTok", "YouTube Shorts", "Newsletter"] },
          format: { type: "string" },
          goal: { type: "string", enum: ["Reach", "Profile Visits", "Saves", "Follows", "Streams", "Community", "DJ Discovery", "Curator Discovery"] },
          phaseCode: { type: "string", enum: ["discovery", "hook-test", "anticipation", "launch", "momentum", "revival"] },
          relativeDay: { type: "integer", minimum: -21, maximum: 45 },
          audienceSegment: { type: "string" },
          contentAngle: { type: "string" },
          experimentTitle: { type: "string" },
        },
      },
    },
    learningsApplied: { type: "array", items: { type: "string" } },
  },
} as const;

const PLANNER_INSTRUCTIONS = `You are the campaign strategist inside Atlas Irwin Studio.
Atlas Irwin is an independent electronic artist. Build a testable, artist-specific campaign, not a generic social media checklist.

Rules:
- Every creative idea must come from the supplied release identity, sonic hook, emotion, visual world, or story.
- Treat historical learnings as evidence only when they are explicitly supplied. Never invent performance claims.
- Each experiment tests one clear hypothesis and has 2 or 3 meaningfully different variants.
- Every experiment must be attached to exactly one content moment. Do not reuse the same experimentTitle across multiple platforms or posting times. Cross-platform repurposing happens only after a winner is found.
- Variants should differ in the first-second hook, framing, or audience promise, not just punctuation.
- Keep captions concise, human, specific, and compatible with an artist voice. Avoid marketing jargon, fake urgency, generic AI language, and repetitive "out now" posts.
- Use platform-native formats but keep one coherent campaign world.
- Prefer a small number of strong experiments over content volume.
- Use release-relative timing. Day 0 is the release date.
- Include at least one DJ/selector or curator discovery angle when it fits the release.
- The goal is to learn what moves the right listeners toward saves, follows, smart-link clicks, streams, playlist adds, and genuine community signals.`;

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function normalizeCampaignPlan(plan: CampaignPlan): CampaignPlan {
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
  const contentMoments = plan.contentMoments.map((moment) => {
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

function fallbackPlan(context: CampaignPlanningContext): CampaignPlan {
  const release = context.release;
  const title = release.title;
  const emotion = firstNonEmpty(release.core_emotion, "late-night connection");
  const sonicHook = firstNonEmpty(release.primary_hook, "the strongest musical turn in the track");
  const visual = firstNonEmpty(release.visual_direction, "warm analog light, motion and tactile electronic detail");
  const audience = firstNonEmpty(release.audience, "independent electronic and nu-disco listeners");
  const primaryKpi = OBJECTIVE_KPIS[context.objective].primary;
  const learned = context.approvedLearnings.slice(0, 4);

  return normalizeCampaignPlan({
    strategySummary: `${title} should be marketed through the tension between ${emotion} and ${sonicHook}. Test the musical payoff before scaling reach, then move winning framing into release-day conversion and post-release discovery.`,
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
            productionNotes: "Open on the payoff within the first 0.5 seconds. 8 to 12 seconds. No intro card.",
          },
          {
            label: "B",
            hookText: `Berlin, late enough that the bass becomes the plan.`,
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
        primaryMetric: "selector_action_rate",
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
      { title: `${title}: world signal`, platform: "Instagram", format: "Reel", goal: "Reach", phaseCode: "discovery", relativeDay: -14, audienceSegment: audience, contentAngle: "world and mood", experimentTitle: "" },
      { title: `${title}: hook test`, platform: "Instagram", format: "Reel", goal: context.objective, phaseCode: "hook-test", relativeDay: -7, audienceSegment: audience, contentAngle: "musical payoff", experimentTitle: "Sonic payoff framing" },
      { title: `${title}: hook winner replication slot`, platform: "TikTok", format: "TikTok video", goal: context.objective, phaseCode: "hook-test", relativeDay: -5, audienceSegment: audience, contentAngle: "reserved for a proven framing or a non-experimental platform-native cut", experimentTitle: "" },
      { title: `${title}: release-day conversion`, platform: "Instagram", format: "Reel", goal: "Streams", phaseCode: "launch", relativeDay: 0, audienceSegment: audience, contentAngle: "winning hook plus full-track promise", experimentTitle: "" },
      { title: `${title}: selector clip`, platform: "Instagram", format: "DJ clip", goal: "DJ Discovery", phaseCode: "momentum", relativeDay: 5, audienceSegment: "DJs and selectors who program warm electronic music", contentAngle: "selector utility", experimentTitle: "Selector utility" },
      { title: `${title}: process detail`, platform: "YouTube Shorts", format: "Short", goal: "Follows", phaseCode: "momentum", relativeDay: 9, audienceSegment: audience, contentAngle: "human process", experimentTitle: "" },
      { title: `${title}: catalog re-entry`, platform: "Instagram", format: "Reel", goal: "Streams", phaseCode: "revival", relativeDay: 28, audienceSegment: audience, contentAngle: "rediscovery through a different musical detail", experimentTitle: "" },
    ],
  });
}

export async function planCampaign(context: CampaignPlanningContext) {
  if (!marketingAiConfigured()) {
    return {
      plan: fallbackPlan(context),
      generation: { provider: "template", model: "adaptive-fallback", requestId: null },
    } as const;
  }

  const input = JSON.stringify({
    release: context.release,
    objective: context.objective,
    brandContext: context.brandContext,
    approvedLearnings: context.approvedLearnings,
    performanceSummary: context.performanceSummary,
  }, null, 2);
  try {
    const generated = await generateStructured<CampaignPlan>({
      name: "atlas_campaign_plan",
      schema: planSchema as unknown as Record<string, unknown>,
      instructions: PLANNER_INSTRUCTIONS,
      input,
    });
    return { plan: normalizeCampaignPlan(generated.value), generation: generated } as const;
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
