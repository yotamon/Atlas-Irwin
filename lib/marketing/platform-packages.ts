export type SocialOutputKind = "image" | "video";

export type SocialPlatformPackage = {
  id: string;
  platform: "Instagram" | "TikTok" | "YouTube Shorts";
  format: string;
  outputKind: SocialOutputKind;
  width: number;
  height: number;
  aspectRatio: "9:16" | "4:5" | "1:1";
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  maxAssets: number;
  safeArea: {
    topPercent: number;
    rightPercent: number;
    bottomPercent: number;
    leftPercent: number;
  };
  rules: string[];
};

const PACKAGES: SocialPlatformPackage[] = [
  {
    id: "instagram-reel",
    platform: "Instagram",
    format: "Reel",
    outputKind: "video",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    minDurationSeconds: 4,
    maxDurationSeconds: 90,
    maxAssets: 1,
    safeArea: { topPercent: 8, rightPercent: 8, bottomPercent: 20, leftPercent: 8 },
    rules: [
      "Design the first frame as a cover-worthy composition; do not depend on a separate poster to rescue a weak opening.",
      "Keep essential typography out of the bottom interaction area.",
      "Prefer a decisive first-second visual or musical promise over a title card.",
    ],
  },
  {
    id: "instagram-story",
    platform: "Instagram",
    format: "Story",
    outputKind: "video",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    minDurationSeconds: 3,
    maxDurationSeconds: 60,
    maxAssets: 1,
    safeArea: { topPercent: 12, rightPercent: 8, bottomPercent: 18, leftPercent: 8 },
    rules: [
      "Treat the story as an intimate vertical canvas, not a cropped Reel.",
      "Reserve clean space for native stickers or links when the campaign needs them.",
      "Do not bake UI-looking CTA buttons into generated media.",
    ],
  },
  {
    id: "instagram-feed-portrait",
    platform: "Instagram",
    format: "Feed Post",
    outputKind: "image",
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
    minDurationSeconds: null,
    maxDurationSeconds: null,
    maxAssets: 1,
    safeArea: { topPercent: 5, rightPercent: 5, bottomPercent: 5, leftPercent: 5 },
    rules: [
      "Use editorial composition rather than a social template.",
      "Typography and logos belong to deterministic finishing, not generative rendering.",
    ],
  },
  {
    id: "instagram-carousel",
    platform: "Instagram",
    format: "Carousel",
    outputKind: "image",
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
    minDurationSeconds: null,
    maxDurationSeconds: null,
    maxAssets: 10,
    safeArea: { topPercent: 5, rightPercent: 5, bottomPercent: 5, leftPercent: 5 },
    rules: [
      "Every frame must belong to one visual system while contributing new information or rhythm.",
      "Frame one must work independently as the cover and make the swipe promise clear.",
      "Do not repeat the same generated composition with different text.",
    ],
  },
  {
    id: "tiktok-video",
    platform: "TikTok",
    format: "TikTok video",
    outputKind: "video",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    minDurationSeconds: 4,
    maxDurationSeconds: 60,
    maxAssets: 1,
    safeArea: { topPercent: 8, rightPercent: 18, bottomPercent: 22, leftPercent: 7 },
    rules: [
      "Make the opening native and immediate; avoid cinematic pre-roll that delays the point.",
      "Keep essential visual information clear of right-side controls and bottom caption chrome.",
      "Do not add external watermarks, promotional logos or fake TikTok UI.",
    ],
  },
  {
    id: "tiktok-photo",
    platform: "TikTok",
    format: "TikTok photo",
    outputKind: "image",
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
    minDurationSeconds: null,
    maxDurationSeconds: null,
    maxAssets: 35,
    safeArea: { topPercent: 6, rightPercent: 10, bottomPercent: 16, leftPercent: 6 },
    rules: [
      "Treat photo mode as an intentional sequence, not leftover stills from a video campaign.",
      "Choose a deliberate cover frame and preserve visual progression across the set.",
      "Do not add external watermarks or promotional branding into the exported imagery.",
    ],
  },
  {
    id: "youtube-short",
    platform: "YouTube Shorts",
    format: "Short",
    outputKind: "video",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    minDurationSeconds: 4,
    maxDurationSeconds: 60,
    maxAssets: 1,
    safeArea: { topPercent: 8, rightPercent: 12, bottomPercent: 18, leftPercent: 8 },
    rules: [
      "The video must make sense without relying on the title or description for setup.",
      "Prefer a durable music-discovery hook over TikTok-specific trend mimicry.",
      "Keep typography readable on phones and out of interaction chrome.",
    ],
  },
];

function normalized(value: string) {
  return value.trim().toLowerCase();
}

export function socialPlatformPackage(platform: string, format: string, outputKind: SocialOutputKind): SocialPlatformPackage {
  const p = normalized(platform);
  const f = normalized(format);
  const exact = PACKAGES.find((item) => normalized(item.platform) === p && normalized(item.format) === f && item.outputKind === outputKind);
  if (exact) return exact;

  if (p.includes("instagram")) {
    if (outputKind === "video") return PACKAGES.find((item) => item.id === "instagram-reel")!;
    return PACKAGES.find((item) => item.id === "instagram-feed-portrait")!;
  }
  if (p.includes("tiktok")) {
    return PACKAGES.find((item) => item.id === (outputKind === "video" ? "tiktok-video" : "tiktok-photo"))!;
  }
  return PACKAGES.find((item) => item.id === "youtube-short")!;
}

export function socialPlatformPackages() {
  return PACKAGES.map((item) => ({ ...item, rules: [...item.rules], safeArea: { ...item.safeArea } }));
}
