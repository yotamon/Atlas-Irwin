export const CREATE_OUTCOMES = [
  {
    id: "reach",
    label: "Get heard",
    shortLabel: "Stop the scroll",
    description: "Turn this musical section into a concise discovery creative that earns attention before asking for anything else.",
    platform: "Instagram",
    format: "Reel",
    goal: "Reach",
    mediaKind: "video",
    titleSuffix: "discovery cut",
    workflow: "standard",
    sourceMode: "moment",
  },
  {
    id: "streams",
    label: "Drive streams",
    shortLabel: "Move listeners to the song",
    description: "Use the section as the payoff, then make the release and listening action obvious without turning the creative into an ad.",
    platform: "Instagram",
    format: "Reel",
    goal: "Streams",
    mediaKind: "video",
    titleSuffix: "stream driver",
    workflow: "standard",
    sourceMode: "moment",
  },
  {
    id: "lyric",
    label: "Make the lyric stick",
    shortLabel: "Put the words in focus",
    description: "Build a lyric-led creative around the exact approved musical window so the line and the song reinforce each other.",
    platform: "Instagram",
    format: "Reel",
    goal: "Saves",
    mediaKind: "video",
    titleSuffix: "lyric creative",
    workflow: "standard",
    sourceMode: "moment",
  },
  {
    id: "visual",
    label: "Build recognition",
    shortLabel: "Create release visuals",
    description: "Turn the release artwork into a polished social visual, then animate it only when motion adds value.",
    platform: "Instagram",
    format: "Release visual",
    goal: "Recognition",
    mediaKind: "image",
    titleSuffix: "release visual",
    workflow: "release_visual",
    sourceMode: "release",
  },
] as const;

export type CreateOutcomeId = (typeof CREATE_OUTCOMES)[number]["id"];
export type CreateOutcome = (typeof CREATE_OUTCOMES)[number];

export function resolveCreateOutcome(value: string | null | undefined): CreateOutcome | null {
  if (!value) return null;
  return CREATE_OUTCOMES.find((outcome) => outcome.id === value) ?? null;
}

export function resolveCreateOutcomeIntent(value: string | null | undefined): CreateOutcome | null {
  if (!value) return null;
  const exact = resolveCreateOutcome(value.trim().toLowerCase());
  if (exact) return exact;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return null;
  if (/\b(?:lyric|lyrics|words|captioned lyric)\b/.test(normalized)) return resolveCreateOutcome("lyric");
  if (/\b(?:visualizer|visual|mood|loop|artwork|cover)\b/.test(normalized)) return resolveCreateOutcome("visual");
  if (/\b(?:stream|streams|spotify|listen|listening)\b/.test(normalized)) return resolveCreateOutcome("streams");
  if (/\b(?:reel|short|clip|tiktok|instagram|social|promo|post|story|video)\b/.test(normalized)) return resolveCreateOutcome("reach");
  return null;
}
