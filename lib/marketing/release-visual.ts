import { dayDistance, releaseLifecycle } from "@/lib/marketing/release-lifecycle";

export const RELEASE_VISUAL_MARKER = "[release-visual:v1]";
export const RELEASE_VISUAL_WORKFLOW = "release_visual" as const;

export const RELEASE_VISUAL_STAGES = ["source", "message", "design", "review", "use"] as const;
export type ReleaseVisualStage = (typeof RELEASE_VISUAL_STAGES)[number];

export const RELEASE_VISUAL_MESSAGE_INTENTS = [
  "clean",
  "out_now",
  "out_friday",
  "pre_save",
  "listen_now",
  "custom",
] as const;
export type ReleaseVisualMessageIntent = (typeof RELEASE_VISUAL_MESSAGE_INTENTS)[number];

export const RELEASE_VISUAL_LAYOUTS = [
  "cover_focus",
  "editorial_split",
  "full_bleed",
  "minimal_frame",
] as const;
export type ReleaseVisualLayoutId = (typeof RELEASE_VISUAL_LAYOUTS)[number];

export const RELEASE_VISUAL_PACKAGE_IDS = [
  "instagram-story-image",
  "instagram-feed-portrait",
  "instagram-square",
] as const;
export type ReleaseVisualPackageId = (typeof RELEASE_VISUAL_PACKAGE_IDS)[number];

export const RELEASE_VISUAL_SOURCE_ROLE = "release_visual_source";
export const RELEASE_VISUAL_PRIMARY_ROLE = "release_visual_primary";
export const RELEASE_VISUAL_STORY_ROLE = "release_visual_story";
export const RELEASE_VISUAL_FEED_ROLE = "release_visual_feed_portrait";
export const RELEASE_VISUAL_SQUARE_ROLE = "release_visual_square";
export const LIVING_ARTWORK_EXPLICIT_SOURCE_ROLE = "living_artwork_source";

export type ReleaseVisualCopy = {
  eyebrow: string | null;
  headline: string | null;
  title: string | null;
  artistName: string | null;
  dateLabel: string | null;
  supportingLine: string | null;
  cta: string | null;
};

export type ReleaseVisualSpec = {
  version: 1;
  artistId: string;
  releaseId: string;
  contentItemId: string;
  sourceAssetId: string | null;
  sourceUrl: string;
  messageIntent: ReleaseVisualMessageIntent;
  copy: ReleaseVisualCopy;
  layout: ReleaseVisualLayoutId;
  primaryPackageId: ReleaseVisualPackageId;
  visualBrandVersionId: string | null;
  visualBrandFingerprint: string | null;
  backgroundTreatment: "extended_blur" | "solid" | "full_bleed";
  textTreatment: {
    family: "display" | "supporting";
    weight: "regular" | "medium" | "bold";
    case: "original" | "uppercase";
    align: "left" | "center";
  };
};

function berlinDateKey(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function weekdayUtc(date: string) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function defaultReleaseVisualMessage(input: {
  releaseDate?: string | null;
  status?: string | null;
  isArchived?: boolean | null;
  now?: Date;
}): ReleaseVisualMessageIntent {
  const now = input.now ?? new Date();
  const lifecycle = releaseLifecycle({
    releaseDate: input.releaseDate,
    status: input.status,
    isArchived: input.isArchived,
  }, now);

  if (lifecycle === "archived" || lifecycle === "development") return "clean";
  if (lifecycle === "launch_window") return "out_now";
  if (lifecycle === "catalog") return "listen_now";

  if (input.releaseDate) {
    const daysUntil = dayDistance(berlinDateKey(now), input.releaseDate);
    if (daysUntil > 0 && daysUntil <= 7 && weekdayUtc(input.releaseDate) === 5) return "out_friday";
  }
  return "pre_save";
}

function formattedReleaseDate(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function defaultReleaseVisualCopy(input: {
  intent: ReleaseVisualMessageIntent;
  releaseTitle: string;
  artistName: string;
  releaseDate?: string | null;
}): ReleaseVisualCopy {
  const base = {
    eyebrow: null,
    title: input.releaseTitle,
    artistName: input.artistName,
    dateLabel: null,
    supportingLine: null,
    cta: null,
  } satisfies Omit<ReleaseVisualCopy, "headline">;

  if (input.intent === "out_now") return { ...base, headline: "OUT NOW", cta: "Listen now" };
  if (input.intent === "out_friday") return {
    ...base,
    headline: "OUT FRIDAY",
    dateLabel: formattedReleaseDate(input.releaseDate),
  };
  if (input.intent === "pre_save") return {
    ...base,
    headline: "PRE-SAVE",
    dateLabel: formattedReleaseDate(input.releaseDate),
    cta: "Pre-save now",
  };
  if (input.intent === "listen_now") return { ...base, headline: "LISTEN NOW", cta: "Listen now" };
  if (input.intent === "custom") return { ...base, headline: null };
  return { ...base, headline: null };
}

export function releaseVisualRoleForPackage(packageId: ReleaseVisualPackageId) {
  if (packageId === "instagram-story-image") return RELEASE_VISUAL_STORY_ROLE;
  if (packageId === "instagram-feed-portrait") return RELEASE_VISUAL_FEED_ROLE;
  return RELEASE_VISUAL_SQUARE_ROLE;
}

export function deriveReleaseVisualStage(state: {
  sourceReady: boolean;
  messageReady: boolean;
  designReady: boolean;
  approved: boolean;
}): ReleaseVisualStage {
  if (state.approved) return "use";
  if (state.designReady) return "review";
  if (state.messageReady) return "design";
  if (state.sourceReady) return "message";
  return "source";
}

export function isReleaseVisualSpec(value: unknown): value is ReleaseVisualSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const spec = value as Partial<ReleaseVisualSpec>;
  return spec.version === 1
    && typeof spec.artistId === "string"
    && typeof spec.releaseId === "string"
    && typeof spec.contentItemId === "string"
    && typeof spec.sourceUrl === "string"
    && RELEASE_VISUAL_MESSAGE_INTENTS.includes(spec.messageIntent as ReleaseVisualMessageIntent)
    && RELEASE_VISUAL_LAYOUTS.includes(spec.layout as ReleaseVisualLayoutId)
    && RELEASE_VISUAL_PACKAGE_IDS.includes(spec.primaryPackageId as ReleaseVisualPackageId)
    && Boolean(spec.copy && typeof spec.copy === "object");
}
