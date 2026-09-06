import type {
  ArtistCareerStage,
  ArtistGoalKind,
  ArtistProjectType,
  ArtistReleaseCadence,
  ArtistSceneRelationshipType,
  ArtistVisibilityMode,
  MarketingInvolvement,
} from "@/types/ensemblis-database";

export type ArtistAiPolicy = {
  writingAllowed: boolean;
  visualsAllowed: boolean;
  musicAllowed: boolean;
  voiceAllowed: boolean;
  likenessAllowed: boolean;
  disclosurePreference: "required_only" | "always";
};

export type ArtistOperatingProfile = {
  marketingInvolvement: MarketingInvolvement;
  careerStage: ArtistCareerStage;
  primaryGoal: ArtistGoalKind;
  visibilityMode: ArtistVisibilityMode;
  contentComfort: string[];
  releaseCadence: ArtistReleaseCadence;
  monthlyBudgetCents: number;
  currency: string;
  aiPolicy: ArtistAiPolicy;
};

export type ArtistGoal = {
  kind: ArtistGoalKind;
  priority: number;
  status: "active" | "paused" | "achieved";
};

export type ArtistSceneProfile = {
  primaryScene: string | null;
  subScenes: string[];
  geographicAffinities: string[];
  audienceHypotheses: unknown[];
  evidence: Record<string, unknown>;
  confidence: number;
};

export type ArtistSceneRelationship = {
  id: string;
  type: ArtistSceneRelationshipType;
  targetName: string;
  targetUrl: string | null;
  fitScore: number;
  confidence: number;
  evidence: Record<string, unknown>;
  status: "candidate" | "verified" | "contacted";
  observedAt: string | null;
  expiresAt: string | null;
};

export type ArtistMissionKind =
  | "release"
  | "catalog_growth"
  | "audience_growth"
  | "scene_entry"
  | "gig"
  | "outreach"
  | "brand"
  | "content"
  | "conversion"
  | "owned_audience";

export type ArtistStrategy = {
  positioning: string;
  growthFocus: string;
  channelPriorities: string[];
  contentStrategy: {
    principle: string;
    preferredSources: string[];
  };
  releaseStrategy: string;
  outreachStrategy: string;
  dontDo: string[];
  humanIntervention: string;
  recommendedMission: {
    kind: ArtistMissionKind;
    title: string;
    rationale: string;
    href: string;
  };
};

export type ArtistOperatingContext = {
  artist: {
    id: string;
    name: string;
    projectType: ArtistProjectType;
  };
  profileConfigured: boolean;
  profile: ArtistOperatingProfile;
  goals: ArtistGoal[];
  scene: ArtistSceneProfile;
  relationships: ArtistSceneRelationship[];
  strategySnapshot: ArtistStrategy | null;
};

export const MARKETING_INVOLVEMENT_LABELS: Record<MarketingInvolvement, string> = {
  hands_on: "Hands-on",
  guided: "Guide me",
  just_make_music: "I just want to make music",
};

export const GOAL_LABELS: Record<ArtistGoalKind, string> = {
  get_heard: "Get heard",
  release_music: "Release music",
  get_gigs: "Get relevant gigs",
  grow_fans: "Grow real fans",
  find_labels: "Find labels and partners",
  build_owned_audience: "Build an owned audience",
};

export function defaultArtistOperatingProfile(
  projectType: ArtistProjectType,
  currency = "EUR",
): ArtistOperatingProfile {
  const aiNativeCapability = projectType === "ai_assisted" || projectType === "hybrid" || projectType === "virtual_persona";
  return {
    marketingInvolvement: "guided",
    careerStage: "emerging",
    primaryGoal: "get_heard",
    visibilityMode: projectType === "virtual_persona" ? "music_first" : "selective",
    contentComfort: [],
    releaseCadence: "steady",
    monthlyBudgetCents: 0,
    currency,
    aiPolicy: {
      writingAllowed: true,
      visualsAllowed: aiNativeCapability,
      musicAllowed: aiNativeCapability,
      voiceAllowed: false,
      likenessAllowed: false,
      disclosurePreference: "required_only",
    },
  };
}

export function creativeSourceHierarchy(profile: ArtistOperatingProfile) {
  const sources = [
    "Real artist media",
    "Existing live or studio footage",
    "Existing photography",
    "Artist artwork",
    "Music visualisation",
    "Deterministic editing",
    "AI-assisted enhancement",
  ];
  if (profile.aiPolicy.visualsAllowed) sources.push("Generative visuals when they strengthen the concept");
  if (profile.aiPolicy.likenessAllowed) sources.push("Synthetic artist likeness only inside the explicit artist policy");
  if (profile.aiPolicy.voiceAllowed) sources.push("Synthetic voice only inside the explicit artist policy");
  return sources;
}

export function artistInterventionPolicy(profile: ArtistOperatingProfile) {
  if (profile.marketingInvolvement === "just_make_music") {
    return "Prepare safe internal marketing work automatically and interrupt only for judgment, spend, sensitive communication or external effects that need approval.";
  }
  if (profile.marketingInvolvement === "hands_on") {
    return "Keep strategy and evidence visible early so the artist can steer important creative and growth decisions directly.";
  }
  return "Prepare the strongest recommendation and supporting work, then ask for the decisions where artist judgment materially improves the outcome.";
}

export function artistCreativePolicyBrief(profile: ArtistOperatingProfile) {
  return [
    "Source-first creative policy: prefer real artist media, live/studio footage, photography, artwork, music visualisation and deterministic editing before synthetic generation.",
    `Generative visuals: ${profile.aiPolicy.visualsAllowed ? "allowed when appropriate" : "not allowed"}.`,
    `AI music generation: ${profile.aiPolicy.musicAllowed ? "allowed" : "not allowed"}.`,
    `Synthetic voice: ${profile.aiPolicy.voiceAllowed ? "allowed inside explicit policy" : "not allowed"}.`,
    `Synthetic artist likeness: ${profile.aiPolicy.likenessAllowed ? "allowed inside explicit policy" : "not allowed"}.`,
  ].join(" ");
}
