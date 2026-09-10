export const MUSIC_PROVIDER_IDS = ["minimax", "eleven"] as const;
export type MusicProviderId = (typeof MUSIC_PROVIDER_IDS)[number];

export const MUSIC_VIBES = [
  { id: "focused", label: "Focused & minimal", detail: "clear musical hierarchy, purposeful space, restrained arrangement and one strong center" },
  { id: "groove", label: "Groove-forward", detail: "physical pocket, rhythmic interplay, memorable low-end movement and human-feeling momentum" },
  { id: "warm", label: "Warm & organic", detail: "tactile timbres, expressive dynamics, harmonic warmth and natural-feeling movement" },
  { id: "kinetic", label: "Kinetic & high-energy", detail: "driving momentum, sharp contrast, controlled intensity and a strong release arc" },
  { id: "atmospheric", label: "Atmospheric & cinematic", detail: "immersive space, evolving texture, patient development and emotional scale" },
] as const;

export type MusicVibeId = (typeof MUSIC_VIBES)[number]["id"];
export const MUSIC_VIBE_IDS = MUSIC_VIBES.map((entry) => entry.id) as [MusicVibeId, ...MusicVibeId[]];

export type MusicGenerationInput = {
  provider: MusicProviderId;
  title: string;
  idea: string;
  vibe: MusicVibeId;
  bpm: number;
  durationSeconds: number;
  instrumental: boolean;
  lyrics?: string;
  signatureIdea?: string;
  brandContext?: string;
  preserveArtistDna: boolean;
};

const ARTIST_DNA_RULES = [
  "Treat supplied artist context as authoritative identity guidance, not as optional decoration.",
  "Preserve the artist's established musical language while making this track distinct from earlier work.",
  "Do not invent genre, era, location, instrumentation, demographic identity or aesthetic rules that are not present in the supplied artist context or creative brief.",
].join(" ");

const ANTI_GENERIC = [
  "Build the track around one memorable musical idea and develop it through arrangement changes instead of stacking unrelated hooks.",
  "Avoid stock genre templates, obvious preset-demo writing, predictable copy-paste sections and overbusy arrangements.",
  "Use tension, release, contrast and variation to make the result feel intentionally authored rather than generically generated.",
].join(" ");

function vibeDetail(vibe: MusicVibeId) {
  return MUSIC_VIBES.find((entry) => entry.id === vibe)?.detail ?? MUSIC_VIBES[0].detail;
}

function clip(value: string | undefined, max: number) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

export function buildMusicPrompt(input: MusicGenerationInput) {
  const idea = clip(input.idea, input.provider === "minimax" ? 420 : 900);
  const signatureIdea = clip(input.signatureIdea, input.provider === "minimax" ? 160 : 400);
  const artistContext = clip(input.brandContext, input.provider === "minimax" ? 620 : 1400);
  const identitySection = input.preserveArtistDna && artistContext
    ? `Artist identity context: ${artistContext}. ${ARTIST_DNA_RULES}`
    : "No artist identity assumptions are permitted beyond the supplied creative brief. Make the result distinctive without inventing an artist backstory or default genre identity.";

  const sections = [
    identitySection,
    `Creative direction: ${idea}.`,
    `Energy and feel: ${vibeDetail(input.vibe)}.`,
    `Tempo: ${Math.round(input.bpm)} BPM.`,
    signatureIdea
      ? `Signature musical idea: ${signatureIdea}. Make this the recognizable center of the track.`
      : "Choose one strong signature musical idea and make it the recognizable center of the track.",
    `Target form: approximately ${Math.round(input.durationSeconds / 60)} minutes, with purposeful development, meaningful contrast, a return with variation and a clean ending.`,
    input.instrumental
      ? "Instrumental only. No lead vocals, spoken words or sung phrases unless the creative brief explicitly requires nonverbal vocal texture."
      : "Use the provided lyrics as the vocal content. Keep vocal production consistent with the artist context and creative direction rather than forcing a generic pop treatment.",
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
    .slice(0, 60) || "music-lab-draft";
  return `${base}-${provider}-${index}.mp3`;
}
