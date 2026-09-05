export const CREATE_OUTCOMES = [
  {
    id: "reach",
    label: "Get heard",
    shortLabel: "Stop the scroll",
    description: "Turn this musical Moment into a concise discovery creative that earns attention before asking for anything else.",
    platform: "Instagram",
    format: "Reel",
    goal: "Reach",
    mediaKind: "video",
    titleSuffix: "discovery cut",
  },
  {
    id: "streams",
    label: "Drive streams",
    shortLabel: "Move listeners to the song",
    description: "Use the Moment as the payoff, then make the release and listening action obvious without turning the creative into an ad.",
    platform: "Instagram",
    format: "Reel",
    goal: "Streams",
    mediaKind: "video",
    titleSuffix: "stream driver",
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
  },
  {
    id: "visual",
    label: "Build recognition",
    shortLabel: "Create a memorable visual loop",
    description: "Extend the artist visual world around this Moment so repeated exposure feels coherent and recognizable rather than like a new AI aesthetic.",
    platform: "Instagram",
    format: "Mood video",
    goal: "Saves",
    mediaKind: "video",
    titleSuffix: "visual loop",
  },
] as const;

export type CreateOutcomeId = (typeof CREATE_OUTCOMES)[number]["id"];
export type CreateOutcome = (typeof CREATE_OUTCOMES)[number];

export function resolveCreateOutcome(value: string | null | undefined): CreateOutcome | null {
  if (!value) return null;
  return CREATE_OUTCOMES.find((outcome) => outcome.id === value) ?? null;
}
