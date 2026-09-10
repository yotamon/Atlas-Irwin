import type { MarketingObjective } from "./domain";
import type { IntelligentCampaignPlan } from "./marketing-intelligence";

export const ARTIST_MARKETING_ARCHETYPES = [
  "performer",
  "storyteller",
  "producer",
  "selector_dj",
  "world_builder",
  "community_artist",
  "faceless_virtual",
] as const;
export type ArtistMarketingArchetype = (typeof ARTIST_MARKETING_ARCHETYPES)[number];

export const FULL_MARKETING_FUNNEL = [
  "discovery",
  "interest",
  "resonance",
  "relationship",
  "listening",
  "fandom",
  "superfan",
] as const;
export type FullMarketingFunnelStage = (typeof FULL_MARKETING_FUNNEL)[number];

const FUNNEL_JOBS: Record<FullMarketingFunnelStage, { job: string; primarySignals: string[] }> = {
  discovery: {
    job: "Earn native attention from people who do not know the artist yet, led by a musical, visual or lyrical hook rather than a release announcement.",
    primarySignals: ["qualified_reach", "watch_time_per_view", "share_rate"],
  },
  interest: {
    job: "Turn curiosity into deliberate exploration of the artist, profile and surrounding catalogue.",
    primarySignals: ["profile_visit_rate", "save_rate"],
  },
  resonance: {
    job: "Create emotional or identity value strong enough to save, share or talk about.",
    primarySignals: ["save_rate", "share_rate", "meaningful_engagement_rate"],
  },
  relationship: {
    job: "Deepen recurring connection through personality, process, story and direct community interaction.",
    primarySignals: ["follow_rate", "comment_rate", "returning_viewer_signal"],
  },
  listening: {
    job: "Convert social interest into intentional full-track listening and catalogue exploration.",
    primarySignals: ["link_click_rate", "streams_per_reach", "playlist_add_rate"],
  },
  fandom: {
    job: "Reward people who return with deeper catalogue, participation, scene context, UGC and community belonging.",
    primarySignals: ["returning_listener_signal", "meaningful_engagement_rate", "playlist_add_rate"],
  },
  superfan: {
    job: "Give the highest-intent fans meaningful ways to advocate, attend, collect or participate without over-monetizing the relationship.",
    primarySignals: ["repeat_listening", "advocacy_signal", "ticket_or_merch_intent"],
  },
};

export type MarketingProductLayerMemory = {
  positivePreferences: string[];
  negativePreferences: string[];
  semanticDescriptors: string[];
  visualDescriptors: string[];
  recommendationCount: number;
};

export type MarketingProductLayerInput = {
  intelligence: IntelligentCampaignPlan;
  objective: MarketingObjective;
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
  };
  brandContext: string[];
  approvedLearnings: string[];
  previousCreativeCount: number;
  creativeMemory: MarketingProductLayerMemory;
};

function text(input: MarketingProductLayerInput) {
  return [
    input.artistName,
    input.release.title,
    input.release.story,
    input.release.core_emotion,
    input.release.audience,
    input.release.primary_hook,
    input.release.visual_direction,
    input.release.genre,
    input.release.subgenre,
    ...input.brandContext,
    ...input.approvedLearnings,
    ...input.creativeMemory.positivePreferences,
    ...input.creativeMemory.semanticDescriptors,
    ...input.creativeMemory.visualDescriptors,
  ].filter(Boolean).join(" ").toLowerCase();
}

function cueScore(source: string, cues: RegExp[]) {
  return cues.reduce((score, cue) => score + (cue.test(source) ? 1 : 0), 0);
}

function inferArchetypes(input: MarketingProductLayerInput) {
  const source = text(input);
  const scores: Record<ArtistMarketingArchetype, number> = {
    performer: cueScore(source, [/\blive\b/, /\bstage\b/, /perform/, /\bvocal/, /dance|choreograph/]),
    storyteller: cueScore(source, [/story|narrative/, /lyric/, /meaning/, /emotion|vulnerab/, /confession|memory/]),
    producer: cueScore(source, [/produc/, /studio/, /stem/, /synth/, /sound design/, /gear|arrang/]),
    selector_dj: cueScore(source, [/\bdj\b/, /selector/, /club/, /dancefloor/, /\bmix\b/, /crate|nightlife/]),
    world_builder: cueScore(source, [/visual world/, /cinematic/, /universe/, /\blore\b/, /character/, /conceptual|world-building/]),
    community_artist: cueScore(source, [/community/, /\bfans?\b/, /together/, /\bscene\b/, /collective|movement/, /conversation|comments/]),
    faceless_virtual: cueScore(source, [/virtual/, /avatar/, /anonymous/, /faceless/, /synthetic persona/, /digital character/]),
  };
  if (input.release.visual_direction) scores.world_builder += 1;
  if (input.release.story || input.release.core_emotion) scores.storyteller += 1;
  if (input.objective === "DJ Discovery" || input.objective === "Curator Discovery") scores.selector_dj += 1;
  if (input.objective === "Community") scores.community_artist += 2;
  const ranked = ARTIST_MARKETING_ARCHETYPES
    .map((archetype) => ({ archetype, score: scores[archetype] }))
    .sort((a, b) => b.score - a.score || ARTIST_MARKETING_ARCHETYPES.indexOf(a.archetype) - ARTIST_MARKETING_ARCHETYPES.indexOf(b.archetype));
  const primaryArchetype: ArtistMarketingArchetype = ranked[0]?.score
    ? ranked[0].archetype
    : input.release.visual_direction
      ? "world_builder"
      : "storyteller";
  const secondaryArchetypes = ranked
    .filter((item) => item.archetype !== primaryArchetype && item.score > 0)
    .slice(0, 2)
    .map((item) => item.archetype);
  return { primaryArchetype, secondaryArchetypes };
}

export function artistArchetypeLabel(archetype: ArtistMarketingArchetype) {
  const labels: Record<ArtistMarketingArchetype, string> = {
    performer: "Performer",
    storyteller: "Storyteller",
    producer: "Producer",
    selector_dj: "Selector / DJ",
    world_builder: "World Builder",
    community_artist: "Community Artist",
    faceless_virtual: "Faceless / Virtual",
  };
  return labels[archetype];
}

export function funnelStageForGoal(goal: string): FullMarketingFunnelStage {
  if (goal === "Reach") return "discovery";
  if (goal === "Profile Visits") return "interest";
  if (goal === "Saves" || goal === "DJ Discovery" || goal === "Curator Discovery") return "resonance";
  if (goal === "Follows") return "relationship";
  if (goal === "Streams") return "listening";
  if (goal === "Community") return "fandom";
  return "interest";
}

function deriveContentPillars(input: MarketingProductLayerInput, archetypes: ReturnType<typeof inferArchetypes>) {
  const source = text(input);
  const types = new Set([archetypes.primaryArchetype, ...archetypes.secondaryArchetypes]);
  const scores = new Map<string, number>([["Music", 100]]);
  const add = (pillar: string, score: number) => scores.set(pillar, Math.max(scores.get(pillar) ?? 0, score));

  if (types.has("storyteller") || input.release.story || input.release.core_emotion) add("Story", 82);
  if (types.has("producer") || types.has("selector_dj")) add("Process", 82);
  if (types.has("world_builder") || types.has("faceless_virtual") || input.release.visual_direction) add("World", 82);
  if (types.has("performer") || types.has("storyteller")) add("Personality", 70);
  if (types.has("community_artist") || /community|scene|collective/.test(source)) add("Community", 78);
  if (types.has("selector_dj")) add("Proof", 72);
  if (input.previousCreativeCount > 5 || input.creativeMemory.recommendationCount > 2) add("Catalogue", 68);

  if (input.objective === "Streams" || input.objective === "Profile Visits") add("Conversion", 96);
  if (input.objective === "Community" || input.objective === "Follows") add("Community", 96);
  if (input.objective === "DJ Discovery" || input.objective === "Curator Discovery") add("Proof", 96);
  if (input.objective === "Saves") add("Story", 90);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([pillar]) => pillar);
}

function richerSignatureSignals(input: MarketingProductLayerInput, existing: string[]) {
  return [...new Set([
    ...existing,
    ...input.creativeMemory.semanticDescriptors.slice(0, 4),
    ...input.creativeMemory.visualDescriptors.slice(0, 4),
    input.release.primary_hook || "",
    input.release.visual_direction || "",
  ].map((item) => item.trim()).filter(Boolean))].slice(0, 12);
}

export function applyMarketingProductLayer(input: MarketingProductLayerInput) {
  const archetypes = inferArchetypes(input);
  const contentPillars = deriveContentPillars(input, archetypes);
  const artistMarketingDna = {
    ...input.intelligence.artistMarketingDna,
    version: "artist-marketing-dna-v2" as const,
    primaryArchetype: archetypes.primaryArchetype,
    secondaryArchetypes: archetypes.secondaryArchetypes,
    signatureSignals: richerSignatureSignals(input, input.intelligence.artistMarketingDna.signatureSignals),
    antiPatterns: [...new Set([
      ...input.intelligence.artistMarketingDna.antiPatterns,
      ...input.creativeMemory.negativePreferences,
    ])].slice(0, 16),
    evidenceSummary: `${input.intelligence.artistMarketingDna.evidenceSummary} Creative Memory contributes ${input.creativeMemory.recommendationCount} ranked reference${input.creativeMemory.recommendationCount === 1 ? "" : "s"}, ${input.creativeMemory.positivePreferences.length} reinforced preference${input.creativeMemory.positivePreferences.length === 1 ? "" : "s"} and ${input.creativeMemory.negativePreferences.length} discouraged preference${input.creativeMemory.negativePreferences.length === 1 ? "" : "s"}.`,
  };
  const stageByContent = new Map(input.intelligence.contentMoments.map((item) => [item.title, funnelStageForGoal(item.goal)]));
  const contentMoments = input.intelligence.contentMoments.map((item) => ({ ...item, funnelStage: funnelStageForGoal(item.goal) }));
  const productionCards = input.intelligence.productionCards.map((card) => ({
    ...card,
    funnelStage: stageByContent.get(card.contentTitle) ?? funnelStageForGoal(input.objective),
  }));
  const funnelStrategy = FULL_MARKETING_FUNNEL.map((stage) => ({ stage, ...FUNNEL_JOBS[stage] }));

  return {
    ...input.intelligence,
    artistMarketingDna,
    contentPillars,
    funnelStrategy,
    contentMoments,
    productionCards,
  };
}
