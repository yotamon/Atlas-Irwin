import {
  artistInterventionPolicy,
  creativeSourceHierarchy,
  type ArtistOperatingContext,
  type ArtistStrategy,
} from "@/lib/artist-operating/domain";

function sceneName(context: ArtistOperatingContext) {
  return context.scene.primaryScene?.trim() || "the artist's strongest evidence-backed scene";
}

function contentPrinciple(context: ArtistOperatingContext) {
  if (context.profile.visibilityMode === "anonymous") {
    return "Let the music, artwork, live atmosphere and scene language carry the identity without manufacturing a face-forward persona.";
  }
  if (context.profile.visibilityMode === "music_first") {
    return "Lead with the strongest musical Moments and real project assets; personality supports the music rather than replacing it.";
  }
  return "Prefer authentic artist/source media and strong musical Moments before generating anything synthetic.";
}

function strategyForGoal(context: ArtistOperatingContext): Pick<ArtistStrategy, "growthFocus" | "channelPriorities" | "releaseStrategy" | "outreachStrategy" | "recommendedMission"> {
  const scene = sceneName(context);
  switch (context.profile.primaryGoal) {
    case "get_gigs":
      return {
        growthFocus: `Turn existing music and live credibility into relevant bookings inside ${scene}.`,
        channelPriorities: ["Promoter and festival relationships", "Live/studio proof", "Scene-relevant social and owned web"],
        releaseStrategy: "Use releases as booking proof and scene signals, not as the only unit of career progress.",
        outreachStrategy: "Prioritize evidence-backed promoters, festivals and venues; prepare personal outreach only after fit is verified.",
        recommendedMission: { kind: "gig", title: `Build a credible booking path into ${scene}`, rationale: "The artist's stated priority is relevant gigs, so scene relationships should outrank generic posting volume.", href: "/studio/growth/strategy" },
      };
    case "find_labels":
      return {
        growthFocus: `Build evidence-backed label and curator fit around the strongest unreleased or catalog music in ${scene}.`,
        channelPriorities: ["Label and DJ relationships", "SoundCloud / long-form listening", "Direct curator outreach"],
        releaseStrategy: "Keep release timing flexible when credible label conversations could materially improve reach or fit.",
        outreachStrategy: "Research label fit from roster, releases and scene evidence before preparing a concise music-first approach.",
        recommendedMission: { kind: "outreach", title: "Build the next evidence-backed label shortlist", rationale: "Label fit should come from roster and scene evidence rather than broad cold outreach.", href: "/studio/growth/strategy" },
      };
    case "release_music":
      return {
        growthFocus: "Move the strongest ready music through a release Mission without turning launch preparation into artist admin.",
        channelPriorities: ["Release destinations", "Moment-led social", "Owned release page / smart link"],
        releaseStrategy: "Use Track Intelligence and approved Moments as the source of release creative, then sustain winners beyond launch week.",
        outreachStrategy: "Add only release-specific outreach targets whose audience and timing are supported by evidence.",
        recommendedMission: { kind: "release", title: "Move the strongest ready track into a release Mission", rationale: "Release execution is the stated priority and existing Ensemblis release infrastructure can orchestrate it end-to-end.", href: "/studio/music" },
      };
    case "grow_fans":
      return {
        growthFocus: "Turn qualified listening into repeat attention and identifiable fan relationships instead of maximizing raw reach.",
        channelPriorities: ["Best-performing discovery channel", "Owned artist destination", "Audience / Fan Graph"],
        releaseStrategy: "Use new and catalog music as recurring reasons to deepen fan relationships, not isolated campaign spikes.",
        outreachStrategy: "Prefer communities and channels with demonstrated listener fit over broad awareness placements.",
        recommendedMission: { kind: "audience_growth", title: "Improve the listener-to-fan conversion loop", rationale: "The stated goal is durable fandom, so conversion and owned relationships matter more than posting frequency.", href: "/studio/growth" },
      };
    case "build_owned_audience":
      return {
        growthFocus: "Convert platform attention into consent-aware first-party audience relationships the artist can keep.",
        channelPriorities: ["Ensemblis Sites / smart links", "Fan Graph", "Highest-quality discovery source"],
        releaseStrategy: "Every meaningful release campaign should have a measurable owned destination and a reason to return.",
        outreachStrategy: "Use external channels primarily when they can send qualified listeners into an owned conversion path.",
        recommendedMission: { kind: "owned_audience", title: "Build the next owned-audience conversion path", rationale: "Owned audience growth compounds across releases and reduces dependence on platform algorithms.", href: "/studio/audience" },
      };
    case "get_heard":
    default:
      return {
        growthFocus: `Put the strongest music in front of more listeners who already participate in ${scene}.`,
        channelPriorities: ["Scene-relevant discovery", "Moment-led social", "Streaming / listening destinations"],
        releaseStrategy: "Use the strongest musical Moments to earn discovery, then keep catalog tracks active when evidence says they still convert.",
        outreachStrategy: "Map playlists, channels, DJs, communities and promoters from evidence before naming targets or sending outreach.",
        recommendedMission: { kind: "scene_entry", title: `Expand discovery inside ${scene}`, rationale: "The artist wants to be heard, so relevant scene distribution beats generic content volume.", href: "/studio/growth/strategy" },
      };
  }
}

export function buildArtistStrategy(context: ArtistOperatingContext): ArtistStrategy {
  const goalStrategy = strategyForGoal(context);
  const projectLabel = context.artist.projectType === "human"
    ? "human-created music"
    : context.artist.projectType.replaceAll("_", " ");
  const scene = sceneName(context);
  const dontDo = [
    "Do not manufacture scene credibility, named targets or audience facts without evidence.",
    "Do not synthesize the artist's voice or likeness unless the artist explicitly enabled it.",
    "Do not optimize for posting volume when a smaller number of stronger music-led actions is more credible.",
  ];
  if (!context.profile.aiPolicy.visualsAllowed) {
    dontDo.push("Do not generate synthetic visuals by default; exhaust real media, artwork, music visualisation and deterministic editing first.");
  }
  if (context.profile.marketingInvolvement === "just_make_music") {
    dontDo.push("Do not turn marketing into a task list for the artist; prepare the work and surface only consequential decisions.");
  }

  return {
    positioning: `${context.artist.name} should be positioned from the actual sound, identity and ${scene} context. Ensemblis treats the project as ${projectLabel}; AI assistance is governed separately by the artist policy.`,
    growthFocus: goalStrategy.growthFocus,
    channelPriorities: goalStrategy.channelPriorities,
    contentStrategy: {
      principle: contentPrinciple(context),
      preferredSources: creativeSourceHierarchy(context.profile),
    },
    releaseStrategy: goalStrategy.releaseStrategy,
    outreachStrategy: goalStrategy.outreachStrategy,
    dontDo,
    humanIntervention: artistInterventionPolicy(context.profile),
    recommendedMission: goalStrategy.recommendedMission,
  };
}
