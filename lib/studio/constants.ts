export const RELEASE_TYPES = [
  "Single",
  "EP",
  "Album",
  "Album Track",
  "Edit",
  "Instrumental",
  "DJ Tool",
] as const;
export const RELEASE_STATUSES = [
  "Idea",
  "In Progress",
  "Scheduled",
  "Live",
  "Archived",
] as const;
export const PLATFORMS = [
  "Instagram",
  "TikTok",
  "YouTube Shorts",
  "SoundCloud",
  "Spotify",
  "Newsletter",
  "Other",
] as const;
export const CONTENT_FORMATS = [
  "Reel",
  "TikTok video",
  "Short",
  "Story",
  "Feed post",
  "Carousel",
  "DJ clip",
  "Process post",
  "Mood video",
  "Announcement",
  "Outreach asset",
] as const;
export const CONTENT_STATUSES = [
  "Idea",
  "Draft",
  "In Production",
  "Ready",
  "Scheduled",
  "Published",
  "Archived",
] as const;
export const GOALS = [
  "Reach",
  "Profile Visits",
  "Saves",
  "Follows",
  "Streams",
  "Community",
  "DJ Discovery",
  "Curator Discovery",
] as const;
export const CONTACT_TYPES = [
  "DJ",
  "Playlist",
  "Curator",
  "Music page",
  "Creator",
  "Club",
  "Community",
  "Press",
  "Other",
] as const;
export const RELATIONSHIP_STATUSES = [
  "Researching",
  "Ready to Contact",
  "Contacted",
  "Replied",
  "Interested",
  "Follow-up Needed",
  "Not Relevant",
  "Archived",
] as const;
export const READINESS_ITEMS = [
  "Audio master",
  "Artwork",
  "Smart link",
  "Release story",
  "Hero visual",
  "At least 6 content pieces",
  "Captions",
  "30-day content plan",
  "Outreach list",
  "At least 10 outreach targets",
  "Post-release review",
] as const;
export const TASK_STATUSES = ["Open", "In Progress", "Done"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;
export const BRAND_SEED: Record<string, string> = {
  "Brand essence":
    "Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, house, electro-funk, and soulful electronic pop. The project feels warm, sensual, polished, emotional, sophisticated, playful, and futuristic.",
  "Voice and tone":
    "Confident, intimate, precise, playful, human. Never corporate or breathlessly promotional.",
  "Music world":
    "Late-night Berlin energy, futuristic disco, Rhodes warmth, chrome synth textures, analog glow, movement, dancefloor intimacy, and human feeling inside digital tools.",
  "Visual world":
    "Warm electronic glow, elegant technology, sensual afterhours energy, chrome reflections, analog warmth, subtle surrealism, movement, and minimal typography.",
  Audience:
    "Dancefloor listeners, independent DJs, electronic-pop explorers, nu-disco communities, and design-aware night people.",
  "Approved phrases":
    "Human feeling inside digital tools; made for the second wind; warm circuitry; movement as release.",
  "Words to avoid":
    "Revolutionary, game-changing, generated, content hack, viral, futuristic vibes.",
  "AI narrative guidance":
    "AI can be present as part of the creative language, but never as a gimmick or the central selling point. Human instinct, taste, direction, curation, songwriting, visual identity, and artistic intention remain central.",
  "Visual exclusions":
    "Cheap cyberpunk, generic sci-fi, robotic clichés, obvious faceless stock-like characters, neon overload, and cheap AI gimmick aesthetics.",
  "Preferred content formats":
    "Short performance fragments; tactile process clips; mood films; DJ-oriented cuts; emotional context; community questions.",
  "CTA library":
    "Listen when the room goes quiet. Save this for later. Send this to someone who moves like this. Which second caught you?",
  "Caption templates":
    "[Emotional truth] + [specific musical or visual detail] + [one quiet invitation].",
  "Visual prompt templates":
    "Vertical 9:16, retro-futuristic, warm electronic glow, elegant technology, Berlin afterhours, futuristic disco, chrome reflections, analog warmth, subtle surrealism, movement; minimal typography.",
  "Outreach message templates":
    "Hi [name] — I’m sharing [release], a warm late-night electronic release built for movement. I thought it might fit your world. Happy to send a private link and context if useful.",
};
