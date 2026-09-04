import type { Release, Track } from "@/types/database";
import type { Moment } from "@/types/moments-database";
import type {
  VideoAspectRatio,
  VideoPeopleMode,
  VideoProjectKind,
  VideoResolution,
  VideoStoryMode,
} from "@/lib/video-director/domain";

export const QUICK_VIDEO_DEFAULT_BUDGET_CREDITS = 250;
export const QUICK_VIDEO_CONCEPT_IDS = [
  "hook_world",
  "performance_pulse",
  "narrative_reveal",
] as const;

export type QuickVideoConceptId = (typeof QUICK_VIDEO_CONCEPT_IDS)[number];

export type QuickVideoConcept = {
  id: QuickVideoConceptId;
  eyebrow: string;
  title: string;
  description: string;
  rationale: string;
  anchorMomentId: string | null;
  anchorMomentLabel: string | null;
  storyMode: VideoStoryMode;
  peopleMode: VideoPeopleMode;
  projectKind: VideoProjectKind;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
};

type QuickVideoRelease = Pick<
  Release,
  "title" | "story" | "core_emotion" | "primary_hook" | "visual_direction"
>;

type QuickVideoTrack = Pick<Track, "id" | "title" | "notes">;

type QuickVideoMoment = Pick<
  Moment,
  "id" | "track_id" | "label" | "moment_type" | "start_ms" | "end_ms" | "hook_score" | "energy_score" | "confidence"
>;

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function momentLabel(moment: QuickVideoMoment | null) {
  if (!moment) return null;
  const start = Math.max(0, Math.floor(moment.start_ms / 1000));
  const end = Math.max(start + 1, Math.ceil(moment.end_ms / 1000));
  return `${moment.label} (${start}s–${end}s)`;
}

function strongestMoment(track: QuickVideoTrack, moments: QuickVideoMoment[]) {
  return moments
    .filter((moment) => moment.track_id === track.id)
    .sort((left, right) => {
      const leftScore = (left.confidence * 0.5) + ((left.hook_score ?? 0) * 0.3) + ((left.energy_score ?? 0) * 0.2);
      const rightScore = (right.confidence * 0.5) + ((right.hook_score ?? 0) * 0.3) + ((right.energy_score ?? 0) * 0.2);
      return rightScore - leftScore || left.start_ms - right.start_ms;
    })[0] ?? null;
}

export function buildQuickVideoConcepts({
  release,
  track,
  moments = [],
}: {
  release: QuickVideoRelease;
  track: QuickVideoTrack;
  moments?: QuickVideoMoment[];
}): QuickVideoConcept[] {
  const moment = strongestMoment(track, moments);
  const anchorMomentId = moment?.id ?? null;
  const anchorMomentLabel = momentLabel(moment);
  const hook = clean(release.primary_hook) ?? anchorMomentLabel ?? `the strongest musical payoff in ${track.title}`;
  const emotion = clean(release.core_emotion) ?? "the track's emotional center";
  const visualDirection = clean(release.visual_direction) ?? "a coherent visual world derived from the release identity";
  const story = clean(release.story) ?? clean(track.notes) ?? `the world around ${release.title}`;

  return [
    {
      id: "hook_world",
      eyebrow: "Best default",
      title: "Build a world around the hook",
      description: `Make ${hook} the visual anchor, then let the edit expand outward into ${visualDirection}.`,
      rationale: moment
        ? `Uses the approved Moment “${moment.label}” as the strongest concrete music cue instead of inventing a generic video concept.`
        : `Uses the release hook and visual direction as the creative spine while keeping music timing authoritative.`,
      anchorMomentId,
      anchorMomentLabel,
      storyMode: "hybrid",
      peopleMode: "director_choice",
      projectKind: "full_music_video",
      aspectRatio: "16:9",
      resolution: "1080p",
    },
    {
      id: "performance_pulse",
      eyebrow: "Movement-led",
      title: "Performance pulse",
      description: `Turn the rhythm and energy of ${track.title} into a tactile performance/movement piece with ${emotion} at the center.`,
      rationale: moment
        ? `Lets the approved Moment “${moment.label}” drive pacing, transitions and the strongest social cutdown.`
        : `Prioritizes musical energy and repeatable visual motifs so the result can produce strong short-form derivatives.`,
      anchorMomentId,
      anchorMomentLabel,
      storyMode: "abstract",
      peopleMode: "prefer_people",
      projectKind: "full_music_video",
      aspectRatio: "16:9",
      resolution: "1080p",
    },
    {
      id: "narrative_reveal",
      eyebrow: "Story-led",
      title: "Narrative reveal",
      description: `Build a simple visual arc from ${story}, revealing the strongest image or transformation when the music reaches its payoff.`,
      rationale: `Keeps the narrative bounded to the release context and synchronizes its reveal to the track instead of creating a disconnected short film.`,
      anchorMomentId,
      anchorMomentLabel,
      storyMode: "narrative",
      peopleMode: "director_choice",
      projectKind: "full_music_video",
      aspectRatio: "16:9",
      resolution: "1080p",
    },
  ];
}
