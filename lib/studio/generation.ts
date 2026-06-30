import type { ContentItem, Release } from "@/types/database";

export interface ContentGenerationProvider {
  generateReleaseIdentity(release: Partial<Release>): Promise<ReleaseIdentity>;
  generateContentPack(
    release: Partial<Release>,
  ): Promise<Array<Partial<ContentItem>>>;
}
export type ReleaseIdentity = {
  oneLineIdentity: string;
  contentAngles: string[];
  emotionalThemes: string[];
  visualDirections: string[];
  openingHooks: string[];
  audienceSegments: string[];
  contentCategories: string[];
};
const guardrails =
  "retro-futuristic, warm electronic glow, elegant technology, sensual late-night energy, Berlin afterhours, futuristic disco, chrome reflections, analog warmth, subtle surrealism, movement and dancefloor energy, minimal typography; avoid generic cyberpunk clichés, cheap AI gimmicks, and stock-like characters";
export class TemplateContentGenerationProvider
  implements ContentGenerationProvider
{
  async generateReleaseIdentity(
    release: Partial<Release>,
  ): Promise<ReleaseIdentity> {
    const title = release.title || "This release";
    const emotion = release.core_emotion || "late-night connection";
    const hook = release.primary_hook || "a tactile electronic hook";
    const audience = release.audience || "curious dancefloor listeners";
    const visual =
      release.visual_direction || "chrome, shadow, and warm motion";
    return {
      oneLineIdentity: `${title} turns ${emotion} into ${hook}.`,
      contentAngles: [
        `The emotional moment behind ${title}`,
        `How ${hook} carries the track`,
        `A visual passage through ${visual}`,
      ],
      emotionalThemes: [
        emotion,
        "human feeling inside digital tools",
        "movement as release",
      ],
      visualDirections: [
        visual,
        "warm silhouettes in chrome reflections",
        "minimal typography over analog-lit motion",
      ],
      openingHooks: [
        `This is what ${emotion} sounds like.`,
        `Wait for the moment the room changes.`,
        `A late-night signal for ${audience}.`,
        `The detail hiding inside ${title}.`,
        "Built for the second wind, not the first impression.",
      ],
      audienceSegments: [
        audience,
        "independent DJs and selectors",
        "nu-disco and electronic-pop communities",
      ],
      contentCategories: [
        "Hero",
        "Hook test",
        "Mood",
        "Process",
        "DJ discovery",
        "Community",
      ],
    };
  }
  async generateContentPack(release: Partial<Release>) {
    const title = release.title || "Untitled release";
    const hook = release.primary_hook || "the moment the groove opens up";
    const specs = [
      ["Hero video", "Instagram", "Reel", "Reach"],
      ["Hook variation A", "TikTok", "TikTok video", "Profile Visits"],
      ["Hook variation B", "YouTube Shorts", "Short", "Reach"],
      ["Hook variation C", "Instagram", "Reel", "Saves"],
      ["Mood film: afterhours", "Instagram", "Mood video", "Saves"],
      ["Mood film: chrome warmth", "TikTok", "Mood video", "Reach"],
      ["Story: emotional context", "Instagram", "Story", "Community"],
      ["Story: release countdown", "Instagram", "Story", "Streams"],
      ["Inside the process", "Instagram", "Process post", "Follows"],
      ["For the selectors", "Instagram", "DJ clip", "DJ Discovery"],
      ["Community question", "Instagram", "Feed post", "Community"],
    ];
    return specs.map(([name, platform, format, goal], index) => ({
      title: `${title} — ${name}`,
      platform,
      format,
      goal,
      status: "Draft",
      hook_text:
        index === 0
          ? `This is ${title}. Turn it up.`
          : `${hook} — which second caught you?`,
      caption: `${title} lives where analog warmth meets movement. A small piece of the world behind the track.`,
      cta:
        goal === "Streams"
          ? "Listen via the link."
          : "Save this and send it to someone who moves like this.",
      visual_prompt: `Vertical 9:16 music visual for ${title}: ${guardrails}.`,
      production_notes:
        "Suggested duration: 10–15 seconds. Open on motion in the first second; use the strongest audio moment; keep text minimal.",
    }));
  }
}
