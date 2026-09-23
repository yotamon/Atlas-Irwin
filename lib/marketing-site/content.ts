import type { MusicMapSection } from "@/lib/video-director/creative-director";
import audioSnapshot from "./audio-snapshot.json";

/** Change this once when marketing moves to /. No product hostname assumption. */
export const MARKETING_BASE = "/website";
export const UPLOAD_PATH = "/studio/music/import";
export const ANALYZE_URL = `/studio/login?next=${encodeURIComponent(UPLOAD_PATH)}`;
export const marketingPath = (path = "") => `${MARKETING_BASE}${path}` || "/";
export type CapabilityStatus = "live" | "beta" | "coming-soon" | "vision";
export type PillarId = "analysis" | "mastering" | "mix" | "promote";

export const pillars: Array<{
  id: PillarId;
  number: string;
  label: string;
  title: string;
  description: string;
  status: CapabilityStatus;
  link: string;
  details: Array<{ title: string; text: string }>;
}> = [
  {
    id: "analysis",
    number: "01",
    label: "Understand",
    title: "Hear what your track is telling you.",
    description:
      "Find the structure, energy and moments that make your music yours. Turn a closer listen into a clearer next move.",
    status: "beta",
    link: "Explore music analysis",
    details: [
      {
        title: "See the shape of your track",
        text: "A musical map brings sections, energy changes and rhythmic context into one view.",
      },
      {
        title: "Find the moments that matter",
        text: "Audition suggested moments in context. Decide which hook, shift or payoff tells your story.",
      },
      {
        title: "Keep the understanding",
        text: "Bring the same track context into mastering, mix preparation and promotion.",
      },
    ],
  },
  {
    id: "mastering",
    number: "02",
    label: "Refine",
    title: "Make it ready to leave the studio.",
    description:
      "Listen with perspective. Inspect loudness, dynamics and tonal balance, then compare your next version with intention.",
    status: "beta",
    link: "Explore mastering",
    details: [
      {
        title: "Understand release readiness",
        text: "Review the technical evidence behind loudness, peaks and dynamics before choosing what to change.",
      },
      {
        title: "Compare with intention",
        text: "Keep the source in context while reviewing mastering results. A louder version is not automatically a better one.",
      },
      {
        title: "Keep your character",
        text: "Your creative decisions stay central. Mastering starts from the music you made.",
      },
    ],
  },
  {
    id: "mix",
    number: "03",
    label: "Mix & Perform",
    title: "Turn tracks into journeys.",
    description:
      "Hear the relationships between tracks. Bring tempo, harmonic context and energy together in a mix that goes somewhere.",
    status: "beta",
    link: "Explore Mix & Perform",
    details: [
      {
        title: "Build a musical sequence",
        text: "Explore track relationships and energy flow as you shape a set from your library.",
      },
      {
        title: "Prepare the transition",
        text: "Use musical context to inform overlap, timing and the movement between tracks.",
      },
      {
        title: "Listen to the whole journey",
        text: "AutoMix brings preparation and rendering into a connected workflow. Review the result with your own ears.",
      },
    ],
  },
  {
    id: "promote",
    number: "04",
    label: "Promote",
    title: "Your track already contains the campaign.",
    description:
      "Start with the hook. Follow the emotional shift. Build creative direction and release content around the actual character of your music.",
    status: "beta",
    link: "Explore promotion",
    details: [
      {
        title: "Start with a musical moment",
        text: "Choose a moment from your track rather than squeezing the whole release into a generic template.",
      },
      {
        title: "Give the sound a visual direction",
        text: "Use musical context and your artist identity to guide creative treatments and content concepts.",
      },
      {
        title: "Build toward the release",
        text: "Connect your chosen moments to a campaign, review the creative and keep approval in your hands.",
      },
    ],
  },
];

/** Publicly released artist audio. Analysis overlays are editorial examples, NOT pipeline output.
 * Keeping the distinction explicit prevents an illustrative arrangement becoming a fake result.
 * Replace the entire fixture with an approved, serialized pipeline snapshot when available.
 */
export const demoTrack = {
  id: "atlas-baby-dont-stop",
  title: "Baby Don't Stop",
  artist: "Atlas Irwin",
  artwork: "/releases/dance-in-color/cover.webp",
  audio:
    "https://zhyjnpajlvwwbvuryeyv.supabase.co/storage/v1/object/public/public-media/c8d2e5a6-148c-4997-859a-b3e7bd75b54e/library/83883a9a-22dd-43c3-bb68-bad2913d9d36-Baby-Don-t-Stop.mp3",
  provenance: "Real artist audio · illustrative analysis",
  example: {
    bpm: 122,
    key: "F minor",
    durationMs: audioSnapshot.durationMs,
    momentStart: 74000,
    momentEnd: 87000,
  },
  sections: [
    {
      id: "intro",
      label: "Intro",
      type: "intro",
      start_ms: 0,
      end_ms: 32000,
      energy: 0.28,
    },
    {
      id: "groove",
      label: "Groove",
      type: "verse",
      start_ms: 32000,
      end_ms: 64000,
      energy: 0.56,
    },
    {
      id: "lift",
      label: "Lift",
      type: "build",
      start_ms: 64000,
      end_ms: 74000,
      energy: 0.72,
    },
    {
      id: "hook",
      label: "Hook",
      type: "chorus",
      start_ms: 74000,
      end_ms: 128000,
      energy: 0.92,
    },
    {
      id: "return",
      label: "Return",
      type: "verse",
      start_ms: 128000,
      end_ms: 184000,
      energy: 0.64,
    },
    {
      id: "outro",
      label: "Outro",
      type: "outro",
      start_ms: 184000,
      end_ms: audioSnapshot.durationMs,
      energy: 0.34,
    },
  ] satisfies MusicMapSection[],
};

// Measured audio geometry is shared by every scene; editorial overlays remain labeled.
export const waveform = audioSnapshot.samples.map((sample) =>
  Math.round(4 + sample * 104),
);

export const faqs = [
  {
    question: "Does Ensemblis generate my music?",
    answer:
      "You bring the music. Ensemblis helps you understand it, review its sound, prepare mixes and build promotion around it. Your authorship stays yours.",
  },
  {
    question: "How do I analyze a track?",
    answer:
      "Choose Analyze a track and sign in with your Ensemblis account. You’ll arrive directly at music import, where uploading a master starts the track-intelligence workflow. Access currently requires an existing account.",
  },
  {
    question: "Are these real analysis results?",
    answer:
      "The listening preview is a real Atlas Irwin release. The visual analysis, mastering comparison and campaign are illustrative examples of the workflow, not measured results for this track. No simulated master or mix is passed off as an audio result.",
  },
  {
    question: "Can I use it without making a mix?",
    answer:
      "Yes. Start with the part of your workflow you need. Understanding, refining and promoting a track do not require you to be a DJ.",
  },
];
