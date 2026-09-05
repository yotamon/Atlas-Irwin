import { OBJECTIVE_KPIS, type MarketingObjective } from "./domain";
import type {
  CampaignPlan,
  CampaignPlanExperiment,
  CampaignPlanVariant,
} from "./planner";

export const MARKETING_FUNNEL_STAGES = [
  "discovery",
  "interest",
  "intent",
  "conversion",
  "retention",
  "superfan",
] as const;

export type MarketingFunnelStage = (typeof MARKETING_FUNNEL_STAGES)[number];

export type MarketingMomentInput = {
  id: string;
  label: string;
  momentType: string;
  startMs: number;
  endMs: number;
  sourceMode: "audio" | "lyrics" | "stems" | "fused";
  purposeTags: string[];
  energyScore: number | null;
  hookScore: number | null;
  emotionalScore: number | null;
  vocalScore: number | null;
  uniquenessScore: number | null;
  confidence: number;
  state: "proposed" | "approved";
  audioSceneId: string | null;
};

export type SelectedMarketingMoment = MarketingMomentInput & {
  durationSeconds: number;
  marketingScore: number;
  selectionReasons: string[];
};

export type ArtistPerformanceInput = {
  title: string;
  platform: string;
  format: string;
  goal: string;
  score: number;
  signal: string;
};

export type ArtistNormalizedPerformance = ArtistPerformanceInput & {
  baselineScore: number;
  normalizedScore: number;
  relativeLabel: "breakout" | "above_baseline" | "baseline" | "below_baseline";
};

export type ArtistMarketingDna = {
  version: "artist-marketing-dna-v1";
  primaryArchetype:
    | "music-first world builder"
    | "selector-first tastemaker"
    | "story-led artist"
    | "community cultivator";
  audiencePromise: string;
  signatureSignals: string[];
  voicePrinciples: string[];
  visualPrinciples: string[];
  antiPatterns: string[];
  evidenceStrength: "low" | "medium" | "high";
  evidenceSummary: string;
};

export type PlatformDirectorBrief = {
  platform: "Instagram" | "TikTok" | "YouTube";
  role: string;
  opening: string;
  pacing: string;
  formats: string[];
  cta: string;
  avoid: string[];
};

export type PublishabilityAssessment = {
  score: number;
  specificityScore: number;
  duplicateRisk: number;
  decision: "publishable" | "revise" | "reject";
  hardRejectReasons: string[];
  reasons: string[];
};

export type ProductionCard = {
  id: string;
  contentTitle: string;
  platform: string;
  format: string;
  funnelStage: MarketingFunnelStage;
  audience: string;
  creativeAngle: string;
  concept: string;
  platformRole: string;
  opening: string;
  musicMomentId: string | null;
  musicMomentLabel: string | null;
  audioStartSeconds: number | null;
  audioEndSeconds: number | null;
  audioIntegrityRule: string;
  sourcePlan: string;
  shotList: string[];
  assetChecklist: string[];
  editRhythm: string;
  textPlan: string;
  cta: string;
  primaryKpi: string;
  generationPolicy: "real_first";
  publishability: PublishabilityAssessment;
};

export type IntelligentCampaignMoment = CampaignPlan["contentMoments"][number] & {
  funnelStage: MarketingFunnelStage;
  musicMomentId: string | null;
  publishability: PublishabilityAssessment;
};

export type IntelligentCampaignPlan = {
  version: "marketing-intelligence-v2";
  strategySummary: string;
  audienceSegments: string[];
  contentPillars: string[];
  learningsApplied: string[];
  artistMarketingDna: ArtistMarketingDna;
  funnelStrategy: Array<{
    stage: MarketingFunnelStage;
    job: string;
    primarySignals: string[];
  }>;
  platformDirectors: PlatformDirectorBrief[];
  experiments: CampaignPlanExperiment[];
  contentMoments: IntelligentCampaignMoment[];
  productionCards: ProductionCard[];
  selectedMusicMoments: SelectedMarketingMoment[];
  normalizedPerformance: ArtistNormalizedPerformance[];
  rejectionSignals: string[];
  qualitySummary: {
    candidatesEvaluated: number;
    selected: number;
    rejected: number;
    averagePublishability: number;
    message: string;
  };
};

export type CampaignIntelligenceInput = {
  plan: CampaignPlan;
  artistName: string;
  release: {
    title: string;
    story: string | null;
    core_emotion: string | null;
    audience: string | null;
    primary_hook: string | null;
    visual_direction: string | null;
    genre: string | null;
    subgenre: string | null;
    release_identity: unknown;
  };
  brandContext: string[];
  approvedLearnings: string[];
  normalizedPerformance: ArtistNormalizedPerformance[];
  selectedMusicMoments: SelectedMarketingMoment[];
  previousCreative: Array<{
    title: string;
    platform: string;
    format: string;
    contentAngle: string | null;
    hookText: string | null;
    caption: string | null;
  }>;
  rejectionSignals: string[];
};

const GENERIC_PATTERNS = [
  /\bout now\b/i,
  /\blink in bio\b/i,
  /\bnew music\b/i,
  /\bdon'?t miss\b/i,
  /\bcoming soon\b/i,
  /\bbig things coming\b/i,
  /\bvibes only\b/i,
  /\bneon city\b/i,
  /\bcyberpunk\b/i,
  /\bfestival crowd\b/i,
  /\bgeneric ai\b/i,
];

export const PLATFORM_DIRECTORS: PlatformDirectorBrief[] = [
  {
    platform: "Instagram",
    role: "Identity, saves and shareable artist-world proof",
    opening:
      "Open on the visual or musical payoff in the first second. The first frame must work without audio, while the audio immediately rewards turning sound on.",
    pacing:
      "Tight 7–18 second vertical edits, clean compositions, deliberate typography and one memorable visual idea.",
    formats: ["Reel", "Story", "Carousel", "Feed"],
    cta: "Prefer saves, shares, profile exploration and listening intent over ad-like urgency.",
    avoid: [
      "generic trend imitation",
      "dense captions",
      "fake social proof",
      "overproduced AI spectacle",
    ],
  },
  {
    platform: "TikTok",
    role: "Native discovery, curiosity and conversation",
    opening:
      "Give immediate context: something weird, useful, human or musically surprising must be clear before the viewer has time to swipe.",
    pacing:
      "Looser, visibly human pacing. Process, performance and reaction can outperform polish when they are specific.",
    formats: ["TikTok video", "Photo post"],
    cta: "Invite a reaction, repeat listen, save or opinion when it naturally fits the piece.",
    avoid: [
      "Instagram reposts",
      "corporate captions",
      "slow logo intros",
      "trend chasing without artist fit",
    ],
  },
  {
    platform: "YouTube",
    role: "Durable discovery and higher-intent music context",
    opening:
      "Demonstrate the creative thesis immediately, then let the musical payoff complete instead of cutting away before resolution.",
    pacing:
      "Use 15–35 second Shorts when the idea needs context, with enough continuity to encourage deeper catalog listening.",
    formats: ["Short", "Video"],
    cta: "Lead toward the full track, related release, channel subscription or a deeper piece of catalog context.",
    avoid: [
      "empty teaser language",
      "long setup before the music",
      "duplicate crops from other platforms",
      "fake urgency",
    ],
  },
];

function scoreValue(value: number | null) {
  return Math.max(0, Math.min(1, value ?? 0));
}

function momentMarketingScore(moment: MarketingMomentInput) {
  const duration = Math.max(0, moment.endMs - moment.startMs) / 1000;
  const durationFit = duration >= 8 && duration <= 32 ? 1 : duration >= 5 && duration <= 45 ? 0.65 : 0.2;
  const fusedBonus = moment.sourceMode !== "audio" ? 0.035 : 0;
  const approvedBonus = moment.state === "approved" ? 0.06 : 0;
  return Math.min(
    1,
    scoreValue(moment.hookScore) * 0.29 +
      scoreValue(moment.emotionalScore) * 0.19 +
      scoreValue(moment.uniquenessScore) * 0.18 +
      scoreValue(moment.energyScore) * 0.12 +
      scoreValue(moment.vocalScore) * 0.07 +
      scoreValue(moment.confidence) * 0.1 +
      durationFit * 0.05 +
      fusedBonus +
      approvedBonus,
  );
}

function intervalOverlap(a: MarketingMomentInput, b: MarketingMomentInput) {
  const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  if (!overlap) return 0;
  const shortest = Math.max(1, Math.min(a.endMs - a.startMs, b.endMs - b.startMs));
  return overlap / shortest;
}

export function selectMarketingMoments(rows: MarketingMomentInput[], limit = 5): SelectedMarketingMoment[] {
  const ranked = rows
    .filter((moment) => moment.endMs > moment.startMs)
    .filter((moment) => moment.endMs - moment.startMs >= 4_000 && moment.endMs - moment.startMs <= 60_000)
    .filter((moment) => moment.state === "approved" || moment.confidence >= 0.68)
    .map((moment) => ({ moment, score: momentMarketingScore(moment) }))
    .filter(({ moment, score }) => moment.state === "approved" || score >= 0.56)
    .sort((a, b) => b.score - a.score);

  const selected: SelectedMarketingMoment[] = [];
  for (const { moment, score } of ranked) {
    if (selected.length >= Math.max(1, Math.min(limit, 5))) break;
    if (selected.some((current) => intervalOverlap(current, moment) >= 0.62)) continue;

    const reasons = [
      moment.state === "approved" ? "human-approved Moment" : "high-confidence proposed Moment",
      moment.hookScore !== null && moment.hookScore >= 0.7 ? "strong hook evidence" : "",
      moment.emotionalScore !== null && moment.emotionalScore >= 0.7 ? "strong emotional evidence" : "",
      moment.uniquenessScore !== null && moment.uniquenessScore >= 0.7 ? "distinctive relative to the track" : "",
      moment.sourceMode !== "audio" ? `${moment.sourceMode} evidence fused with audio` : "",
      moment.audioSceneId ? "portable Audio Scene lineage available" : "",
    ].filter(Boolean);

    selected.push({
      ...moment,
      // Preserve the canonical reviewed musical boundaries exactly.
      startMs: moment.startMs,
      endMs: moment.endMs,
      durationSeconds: (moment.endMs - moment.startMs) / 1000,
      marketingScore: Math.round(score * 100),
      selectionReasons: reasons,
    });
  }
  return selected;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizeArtistPerformance(rows: ArtistPerformanceInput[]): ArtistNormalizedPerformance[] {
  const byBaseline = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.platform.toLowerCase()}::${row.goal.toLowerCase()}`;
    byBaseline.set(key, [...(byBaseline.get(key) ?? []), Math.max(0, row.score)]);
  }

  return rows
    .map((row) => {
      const key = `${row.platform.toLowerCase()}::${row.goal.toLowerCase()}`;
      const baselineScore = median(byBaseline.get(key) ?? []);
      const normalizedScore = row.score / Math.max(1, baselineScore);
      const relativeLabel =
        normalizedScore >= 1.6
          ? "breakout"
          : normalizedScore >= 1.15
            ? "above_baseline"
            : normalizedScore >= 0.75
              ? "baseline"
              : "below_baseline";
      return { ...row, baselineScore, normalizedScore, relativeLabel } as ArtistNormalizedPerformance;
    })
    .sort((a, b) => b.normalizedScore - a.normalizedScore);
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function compileArtistMarketingDna(input: Omit<CampaignIntelligenceInput, "plan" | "previousCreative" | "selectedMusicMoments">): ArtistMarketingDna {
  const strongSelectorEvidence = input.normalizedPerformance.some(
    (row) => /DJ Discovery|Curator Discovery/i.test(row.goal) && row.normalizedScore >= 1.15,
  );
  const strongCommunityEvidence = input.normalizedPerformance.some(
    (row) => /Community|Follows/i.test(row.goal) && row.normalizedScore >= 1.15,
  );
  const storyDepth = (input.release.story ?? "").trim().length;
  const primaryArchetype: ArtistMarketingDna["primaryArchetype"] = strongSelectorEvidence
    ? "selector-first tastemaker"
    : storyDepth >= 180
      ? "story-led artist"
      : strongCommunityEvidence
        ? "community cultivator"
        : "music-first world builder";

  const signatureSignals = Array.from(
    new Set(
      [
        input.release.primary_hook,
        input.release.core_emotion,
        input.release.visual_direction,
        input.release.subgenre,
        input.release.genre,
        ...input.approvedLearnings.slice(0, 3),
      ].filter((value): value is string => hasText(value)),
    ),
  ).slice(0, 8);

  const voicePrinciples = [
    "Specific before promotional: say something that could only belong to this artist or release.",
    "Human language over campaign jargon; no invented backstory, emotions, quotes or social proof.",
    "Let the song, process or point of view earn attention before asking for a click.",
  ];

  const visualPrinciples = [
    input.release.visual_direction?.trim() || "Stay inside the established artist and release visual world.",
    "Prefer real artist footage, canonical artwork and approved references before generative media.",
    "One memorable visual idea beats a montage of unrelated spectacle.",
  ];

  const antiPatterns = Array.from(
    new Set([
      "generic AI spectacle without a release-specific reason",
      "fake urgency and repetitive OUT NOW promotion",
      "fake crowds or invented popularity",
      "cross-posting the same cut without platform-native direction",
      "arbitrary audio trimming that cuts a musical phrase",
      ...input.rejectionSignals,
    ]),
  ).slice(0, 14);

  const evidenceCount =
    input.normalizedPerformance.length +
    input.approvedLearnings.length +
    input.rejectionSignals.length +
    input.brandContext.length;
  const evidenceStrength: ArtistMarketingDna["evidenceStrength"] =
    evidenceCount >= 12 ? "high" : evidenceCount >= 4 ? "medium" : "low";

  const audiencePromise =
    input.release.audience?.trim() ||
    `Give listeners a recognizable reason to return to ${input.artistName}, not just one release announcement.`;

  return {
    version: "artist-marketing-dna-v1",
    primaryArchetype,
    audiencePromise,
    signatureSignals,
    voicePrinciples,
    visualPrinciples,
    antiPatterns,
    evidenceStrength,
    evidenceSummary: `${evidenceCount} artist-local evidence signal${evidenceCount === 1 ? "" : "s"} informed this Marketing DNA.`,
  };
}

export function funnelStageForGoal(goal: string): MarketingFunnelStage {
  if (goal === "Reach") return "discovery";
  if (goal === "Profile Visits" || goal === "Saves") return "interest";
  if (goal === "DJ Discovery" || goal === "Curator Discovery") return "intent";
  if (goal === "Streams") return "conversion";
  if (goal === "Follows" || goal === "Community") return "retention";
  return "interest";
}

export function funnelStrategy(): IntelligentCampaignPlan["funnelStrategy"] {
  return [
    {
      stage: "discovery",
      job: "Earn qualified attention with a musical, visual or human proof point before promotion.",
      primarySignals: ["qualified reach", "hold/watch time", "shares"],
    },
    {
      stage: "interest",
      job: "Deepen recognition with a lyric, production detail, performance or recurring visual/world signal.",
      primarySignals: ["saves", "profile visits", "rewatches"],
    },
    {
      stage: "intent",
      job: "Give high-fit listeners, DJs and curators a concrete reason to keep, share or use the record.",
      primarySignals: ["saves", "shares", "selector/curator actions"],
    },
    {
      stage: "conversion",
      job: "Turn a proven framing into full-track or smart-link intent without becoming a generic ad.",
      primarySignals: ["link clicks", "streams", "playlist adds"],
    },
    {
      stage: "retention",
      job: "Build an ongoing relationship through process, personality, comments and recurring formats.",
      primarySignals: ["follows", "meaningful comments", "returning engagement"],
    },
    {
      stage: "superfan",
      job: "Reward depth with catalog, process, participation, live context and identity-building, not more ads.",
      primarySignals: ["returning listeners", "fan-created activity", "ticket/merch intent"],
    },
  ];
}

function normalizedTokens(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3),
    ),
  );
}

function jaccard(a: string, b: string) {
  const aa = new Set(normalizedTokens(a));
  const bb = new Set(normalizedTokens(b));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  return intersection / (aa.size + bb.size - intersection);
}

function ideaText(input: {
  title: string;
  contentAngle: string;
  variant?: CampaignPlanVariant;
}) {
  return [
    input.title,
    input.contentAngle,
    input.variant?.hookText,
    input.variant?.caption,
    input.variant?.cta,
    input.variant?.visualPrompt,
    input.variant?.productionNotes,
  ]
    .filter(Boolean)
    .join(" ");
}

function matchedAnchorTokens(anchors: string[], candidateText: string) {
  const candidate = new Set(normalizedTokens(candidateText));
  return Array.from(
    new Set(
      anchors.flatMap((anchor) => normalizedTokens(anchor)).filter((token) => candidate.has(token)),
    ),
  );
}

export function scorePublishability(input: {
  title: string;
  platform: string;
  format: string;
  goal: string;
  contentAngle: string;
  variant?: CampaignPlanVariant;
  release: CampaignIntelligenceInput["release"];
  brandContext: string[];
  musicMoment: SelectedMarketingMoment | null;
  curatedMusicAvailable: boolean;
  previousCreative: CampaignIntelligenceInput["previousCreative"];
}): PublishabilityAssessment {
  const text = ideaText(input);
  const anchors = [
    input.release.title,
    input.release.primary_hook ?? "",
    input.release.core_emotion ?? "",
    input.release.visual_direction ?? "",
    input.release.genre ?? "",
    input.release.subgenre ?? "",
    ...input.brandContext.slice(0, 6),
    input.musicMoment?.label ?? "",
    ...(input.musicMoment?.purposeTags ?? []),
  ].filter(Boolean);

  const anchorMatches = matchedAnchorTokens(anchors, text);
  const musicSpecific = Boolean(input.musicMoment);
  const specificityScore = Math.min(
    100,
    18 +
      Math.min(42, anchorMatches.length * 7) +
      (musicSpecific ? 18 : 0) +
      (/dj|curator|selector|process|lyric|vocal|groove|hook|story|detail/i.test(text) ? 10 : 0),
  );

  const duplicateRisk = input.previousCreative.reduce((max, previous) => {
    const previousText = [
      previous.title,
      previous.platform,
      previous.format,
      previous.contentAngle,
      previous.hookText,
      previous.caption,
    ]
      .filter(Boolean)
      .join(" ");
    return Math.max(max, jaccard(text, previousText));
  }, 0);

  const genericHits = GENERIC_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const hardRejectReasons: string[] = [];
  if (duplicateRisk >= 0.74) hardRejectReasons.push("Too semantically similar to existing artist content.");
  if (specificityScore < 38) hardRejectReasons.push("Not specific enough to this artist/release.");
  if (genericHits >= 3) hardRejectReasons.push("Relies on too many generic promotional or AI-content tropes.");
  const isVideo = /reel|tiktok|short|video|story/i.test(`${input.platform} ${input.format}`);
  if (isVideo && !musicSpecific) {
    hardRejectReasons.push(input.curatedMusicAvailable
      ? "Video ignores available curated music Moments."
      : "Music-led video requires an approved curated Moment before production.");
  }

  const platformNative =
    input.platform === "Instagram"
      ? /reel|story|carousel|feed/i.test(input.format)
      : input.platform === "TikTok"
        ? /tiktok|photo|video/i.test(input.format)
        : /YouTube|Short/i.test(input.platform) || /short|video/i.test(input.format);

  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        specificityScore * 0.38 +
          (musicSpecific ? 22 : 9) +
          (platformNative ? 12 : 4) +
          Math.max(0, 12 - genericHits * 5) +
          (1 - duplicateRisk) * 16,
      ),
    ),
  );

  const decision: PublishabilityAssessment["decision"] =
    hardRejectReasons.length > 0 ? "reject" : score >= 72 ? "publishable" : "revise";
  const reasons = [
    `${specificityScore}/100 artist/release specificity`,
    musicSpecific ? "anchored to a curated full musical Moment" : "no curated Moment attached",
    `${Math.round((1 - duplicateRisk) * 100)}% semantic novelty versus existing artist content`,
    platformNative ? "native format for the destination platform" : "format needs stronger platform adaptation",
    genericHits ? `${genericHits} generic-risk pattern${genericHits === 1 ? "" : "s"} detected` : "no obvious generic promotional tropes",
  ];

  return {
    score,
    specificityScore,
    duplicateRisk,
    decision,
    hardRejectReasons,
    reasons,
  };
}

function bestMomentForContent(
  content: CampaignPlan["contentMoments"][number],
  moments: SelectedMarketingMoment[],
  index: number,
) {
  if (!moments.length) return null;
  const target = `${content.contentAngle} ${content.goal} ${content.audienceSegment}`.toLowerCase();
  const ranked = moments
    .map((moment) => {
      const tags = `${moment.label} ${moment.momentType} ${moment.purposeTags.join(" ")}`.toLowerCase();
      let fit = moment.marketingScore;
      if (/dj|selector|curator/.test(target) && /dj|selector|groove|club|mix/.test(tags)) fit += 22;
      if (/save|interest|meaning|lyric|story/.test(target) && /lyric|vocal|emotion|meaning/.test(tags)) fit += 18;
      if (/reach|discovery|hook|payoff/.test(target) && /hook|drop|payoff|energy/.test(tags)) fit += 18;
      if (/process|inside|detail/.test(target) && /stem|instrument|progressive|detail/.test(tags)) fit += 18;
      return { moment, fit };
    })
    .sort((a, b) => b.fit - a.fit);
  return ranked[index % ranked.length]?.moment ?? ranked[0]?.moment ?? null;
}

function platformDirector(platform: string) {
  if (/instagram/i.test(platform)) return PLATFORM_DIRECTORS[0];
  if (/tiktok/i.test(platform)) return PLATFORM_DIRECTORS[1];
  return PLATFORM_DIRECTORS[2];
}

function firstVariant(experiment: CampaignPlanExperiment | undefined) {
  return experiment?.variants?.[0];
}

function keepBestVariants(experiment: CampaignPlanExperiment) {
  return { ...experiment, variants: experiment.variants.slice(0, 2) };
}

export function finalizeCampaignIntelligence(input: CampaignIntelligenceInput): IntelligentCampaignPlan {
  const dna = compileArtistMarketingDna({
    artistName: input.artistName,
    release: input.release,
    brandContext: input.brandContext,
    approvedLearnings: input.approvedLearnings,
    normalizedPerformance: input.normalizedPerformance,
    rejectionSignals: input.rejectionSignals,
  });

  const experimentByTitle = new Map(input.plan.experiments.map((experiment) => [experiment.title, experiment]));
  const candidates = input.plan.contentMoments.map((moment, index) => {
    const experiment = moment.experimentTitle ? experimentByTitle.get(moment.experimentTitle) : undefined;
    const variant = firstVariant(experiment);
    const musicMoment = bestMomentForContent(moment, input.selectedMusicMoments, index);
    const publishability = scorePublishability({
      title: moment.title,
      platform: moment.platform,
      format: moment.format,
      goal: moment.goal,
      contentAngle: moment.contentAngle,
      variant,
      release: input.release,
      brandContext: input.brandContext,
      musicMoment,
      curatedMusicAvailable: input.selectedMusicMoments.length > 0,
      previousCreative: input.previousCreative,
    });
    return {
      moment,
      experiment,
      variant,
      musicMoment,
      publishability,
      funnelStage: funnelStageForGoal(moment.goal),
    };
  });

  // Never backfill hard-rejected ideas just to hit a content quota.
  const selected = candidates
    .filter(
      (candidate) =>
        candidate.publishability.decision !== "reject" &&
        candidate.publishability.score >= 62,
    )
    .sort((a, b) => b.publishability.score - a.publishability.score)
    .slice(0, 5);

  const selectedExperimentTitles = new Set(
    selected
      .map((candidate) => candidate.moment.experimentTitle)
      .filter((title): title is string => Boolean(title)),
  );
  const experiments = input.plan.experiments
    .filter((experiment) => selectedExperimentTitles.has(experiment.title))
    .map(keepBestVariants);

  const contentMoments: IntelligentCampaignMoment[] = selected.map((candidate) => ({
    ...candidate.moment,
    funnelStage: candidate.funnelStage,
    musicMomentId: candidate.musicMoment?.id ?? null,
    publishability: candidate.publishability,
  }));

  const productionCards: ProductionCard[] = selected.map((candidate, index) => {
    const director = platformDirector(candidate.moment.platform);
    const duration = candidate.musicMoment?.durationSeconds ?? 12;
    const resolveStart = Math.max(1, duration - 2);
    const experiment = candidate.experiment;
    const variant = candidate.variant;
    const primaryKpi =
      experiment?.primaryMetric ||
      OBJECTIVE_KPIS[candidate.moment.goal as MarketingObjective]?.primary ||
      candidate.moment.goal;
    return {
      id: `${candidate.moment.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
      contentTitle: candidate.moment.title,
      platform: candidate.moment.platform,
      format: candidate.moment.format,
      funnelStage: candidate.funnelStage,
      audience: candidate.moment.audienceSegment,
      creativeAngle: candidate.moment.contentAngle,
      concept:
        variant?.visualPrompt ||
        `${candidate.moment.contentAngle} inside ${input.release.visual_direction || "the established release world"}.`,
      platformRole: director.role,
      opening: variant?.hookText || director.opening,
      musicMomentId: candidate.musicMoment?.id ?? null,
      musicMomentLabel: candidate.musicMoment?.label ?? null,
      audioStartSeconds: candidate.musicMoment ? candidate.musicMoment.startMs / 1000 : null,
      audioEndSeconds: candidate.musicMoment ? candidate.musicMoment.endMs / 1000 : null,
      audioIntegrityRule: candidate.musicMoment
        ? "Use the full curated Moment boundaries exactly. Never trim the musical phrase arbitrarily; only shorten after an explicit new Moment review."
        : "No curated Moment is available. Do not invent an arbitrary audio cut; route through Moment review before producing a music-led video.",
      sourcePlan:
        "Real artist/release footage and canonical artwork first; deterministic motion/typography second; generated plates only when they extend the established world for a clear production reason.",
      shotList: [
        `0.0–1.0s — prove the hook immediately: ${variant?.hookText || candidate.moment.contentAngle}. Use a real/artwork-led opening frame, never a logo sting.`,
        candidate.musicMoment
          ? `1.0s–${resolveStart.toFixed(1)}s — develop ${candidate.moment.contentAngle} through the complete musical phrase “${candidate.musicMoment.label}”; cuts follow structural changes inside the Moment.`
          : `1.0s–10.0s — develop ${candidate.moment.contentAngle} without inventing a fake music sync; keep the edit viable until a Moment is reviewed.`,
        candidate.musicMoment
          ? `${resolveStart.toFixed(1)}–${duration.toFixed(1)}s — let the full curated Moment resolve, then land the CTA without cutting the musical payoff in half.`
          : "10.0–12.0s — land the CTA cleanly without pretending a musical resolution was analyzed.",
      ],
      assetChecklist: [
        "real artist/release footage or a purpose-shot source clip",
        "canonical release artwork and approved artist-brand references",
        "selected Audio Scene preview or canonical/master audio for the exact Moment",
        "deterministic typography and identity assets",
        "generated plate only if necessary and direction-specific",
      ],
      editRhythm: director.pacing,
      textPlan:
        "Keep on-screen copy sparse, factual and deterministic. Never ask a generative image/video model to render lyrics, logos or platform UI.",
      cta: variant?.cta || director.cta,
      primaryKpi,
      generationPolicy: "real_first",
      publishability: candidate.publishability,
    };
  });

  const averagePublishability = selected.length
    ? Math.round(selected.reduce((sum, candidate) => sum + candidate.publishability.score, 0) / selected.length)
    : 0;

  return {
    version: "marketing-intelligence-v2",
    strategySummary: input.plan.strategySummary,
    audienceSegments: input.plan.audienceSegments,
    contentPillars: input.plan.contentPillars,
    learningsApplied: input.plan.learningsApplied,
    artistMarketingDna: dna,
    funnelStrategy: funnelStrategy(),
    platformDirectors: PLATFORM_DIRECTORS,
    experiments,
    contentMoments,
    productionCards,
    selectedMusicMoments: input.selectedMusicMoments,
    normalizedPerformance: input.normalizedPerformance.slice(0, 24),
    rejectionSignals: input.rejectionSignals,
    qualitySummary: {
      candidatesEvaluated: candidates.length,
      selected: selected.length,
      rejected: candidates.length - selected.length,
      averagePublishability,
      message: selected.length
        ? `Ensemblis evaluated ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} and kept only the ${selected.length} worth producing.`
        : "No candidate cleared the artist-specificity and publishability floor. Improve release identity or curated Moments instead of manufacturing filler.",
    },
  };
}
