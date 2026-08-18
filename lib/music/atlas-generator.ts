export const MUSIC_PROVIDER_IDS = ["minimax", "eleven"] as const;
export type MusicProviderId = (typeof MUSIC_PROVIDER_IDS)[number];

export const ATLAS_VIBES = [
  { id: "late-night", label: "Late-night disco", detail: "sleek, hypnotic, warm, after-hours" },
  { id: "electro-funk", label: "Neon electro-funk", detail: "rubbery bass, crisp drums, bright synth hooks" },
  { id: "club", label: "Club peak-time", detail: "driving, focused, DJ-friendly, energetic without EDM cliches" },
  { id: "neo-soul", label: "Neo-soul glide", detail: "Rhodes-rich, sensual, harmonically warm, laid-back" },
  { id: "cosmic", label: "Cosmic slow-burn", detail: "spacey, patient, cinematic, steadily evolving" },
] as const;

export type AtlasVibeId = (typeof ATLAS_VIBES)[number]["id"];
export const ATLAS_VIBE_IDS = ATLAS_VIBES.map((entry) => entry.id) as [AtlasVibeId, ...AtlasVibeId[]];

export type AtlasMusicInput = {
  provider: MusicProviderId;
  title: string;
  idea: string;
  vibe: AtlasVibeId;
  bpm: number;
  durationSeconds: number;
  instrumental: boolean;
  lyrics?: string;
  signatureIdea?: string;
  useAtlasDna: boolean;
};

const ATLAS_DNA = [
  "Retro-futuristic nu-disco, house and electro-funk with touches of neo-soul harmony.",
  "Berlin late-night energy: sophisticated, physical and club-ready rather than glossy pop.",
  "Warm analog synths, Rhodes, funky guitar, rounded disco bass, glassy percussion and soft atmospheric pads.",
  "Punchy but musical low end, human-feeling groove, tasteful automation and a polished modern mix.",
].join(" ");

const ANTI_GENERIC = [
  "Build the track around one memorable musical idea and develop it through arrangement changes instead of stacking unrelated hooks.",
  "Avoid generic festival EDM, obvious stock disco loops, cheesy retro pastiche, predictable four-bar copy-paste and overbusy arrangements.",
  "Leave room for DJ-friendly transitions, tension, release and a clear identity that could belong to a real artist catalog.",
].join(" ");

function vibeDetail(vibe: AtlasVibeId) {
  return ATLAS_VIBES.find((entry) => entry.id === vibe)?.detail ?? ATLAS_VIBES[0].detail;
}

function clip(value: string | undefined, max: number) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

export function buildAtlasMusicPrompt(input: AtlasMusicInput) {
  const idea = clip(input.idea, input.provider === "minimax" ? 420 : 900);
  const signatureIdea = clip(input.signatureIdea, input.provider === "minimax" ? 160 : 400);
  const sections = [
    input.useAtlasDna ? ATLAS_DNA : "Create a distinctive, production-ready electronic dance track with a coherent sonic identity.",
    `Creative direction: ${idea}.`,
    `Vibe: ${vibeDetail(input.vibe)}.`,
    `Tempo: ${Math.round(input.bpm)} BPM.`,
    signatureIdea ? `Signature musical idea: ${signatureIdea}. Make this the recognizable center of the track.` : "Choose one strong signature motif and make it the recognizable center of the track.",
    `Target form: approximately ${Math.round(input.durationSeconds / 60)} minutes, with a purposeful intro, evolving main groove, contrast or breakdown, return with variation, and a clean outro.`,
    input.instrumental
      ? "Instrumental only. No lead vocals, spoken words or sung phrases. Vocoder-like textures may be used only as nonverbal atmosphere."
      : "Use the provided lyrics as the vocal content. Keep the vocal production integrated with the groove rather than turning the track into mainstream pop.",
    ANTI_GENERIC,
  ];

  const prompt = sections.join(" ").replace(/\s+/g, " ").trim();
  return input.provider === "minimax" ? prompt.slice(0, 2000) : prompt.slice(0, 4100);
}

export function miniMaxGenerationCost(model?: string) {
  return model?.toLowerCase().includes("-free") ? 0 : 0.15;
}

export function estimateMusicCost(
  provider: MusicProviderId,
  durationSeconds: number,
  variants = 1,
  model?: string,
) {
  const count = Math.max(1, variants);
  if (provider === "minimax") return miniMaxGenerationCost(model) * count;
  return 0.15 * (durationSeconds / 60) * count;
}

export function safeTrackFilename(title: string, provider: MusicProviderId, index = 1) {
  const base = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "atlas-draft";
  return `${base}-${provider}-${index}.mp3`;
}
