import type { CreativeProviderId } from "./creative-provider-types";

export const AI_PRICING_AS_OF = "2026-08-19";

export type CreativePreset = "economy" | "balanced" | "premium";
export type CreativeOutputKind = "image" | "video";

export type CreativeModelCandidate = {
  provider: CreativeProviderId;
  model: string;
  label: string;
  priceLabel: string;
  reason: string;
};

export const CREATIVE_PRESETS: Record<CreativePreset, {
  label: string;
  shortLabel: string;
  description: string;
  textStack: string;
  imagePrice: string;
  videoPrice: string;
}> = {
  economy: {
    label: "Economy",
    shortLabel: "Cheapest useful generation",
    description: "For previews, exploration and high-volume testing. Atlas spends the minimum before a creative direction proves itself.",
    textStack: "Z.AI GLM Flash / FlashX",
    imagePrice: "from $0.014",
    videoPrice: "$0.20 motion test",
  },
  balanced: {
    label: "Balanced",
    shortLabel: "Best value · recommended",
    description: "Production-ready quality without premium-model spend. This is the default for most Atlas social creative.",
    textStack: "Gemini 3.7 Flash",
    imagePrice: "about $0.03–$0.045",
    videoPrice: "about $0.64 / 8s 1080p",
  },
  premium: {
    label: "Premium",
    shortLabel: "Best available route",
    description: "For hero assets and difficult brand-continuity work. Atlas favors fidelity and cinematic quality over minimum cost.",
    textStack: "OpenAI / Gemini strong reasoning",
    imagePrice: "about $0.101 at 2K",
    videoPrice: "provider quote before spend",
  },
};

const CANDIDATES: Record<CreativePreset, Record<CreativeOutputKind, CreativeModelCandidate[]>> = {
  economy: {
    image: [
      { provider: "bfl", model: "flux-2-klein-4b", label: "FLUX.2 Klein 4B", priceLabel: "from $0.014 / image", reason: "Lowest-cost multi-reference image route." },
      { provider: "google", model: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", priceLabel: "$0.0336 / 1K image", reason: "Cheap Google fallback when BFL is unavailable." },
      { provider: "higgsfield", model: "nano_banana_2", label: "Nano Banana 2 via Higgsfield", priceLabel: "Higgsfield credit quote", reason: "Existing provider fallback." },
    ],
    video: [
      { provider: "zai", model: "vidu2-image", label: "Vidu 2 Image-to-Video", priceLabel: "$0.20 / 4s 720p", reason: "Very cheap motion proof from the strongest release reference." },
      { provider: "fal", model: "economy_video", label: "fal economy video route", priceLabel: "configured marketplace quote", reason: "Optional marketplace fallback with an explicitly configured endpoint." },
      { provider: "higgsfield", model: "seedance_2_0_mini", label: "Seedance 2.0 Mini", priceLabel: "Higgsfield credit quote", reason: "Existing low-cost Higgsfield fallback." },
    ],
  },
  balanced: {
    image: [
      { provider: "bfl", model: "flux-2-pro-preview", label: "FLUX.2 Pro", priceLabel: "from $0.03 generation · $0.045 edit", reason: "Production image quality with up to eight API references." },
      { provider: "google", model: "gemini-3.1-flash-image", label: "Nano Banana 2", priceLabel: "$0.067 1K · $0.101 2K", reason: "Strong multi-reference brand fallback." },
      { provider: "higgsfield", model: "nano_banana_2", label: "Nano Banana 2 via Higgsfield", priceLabel: "Higgsfield credit quote", reason: "Existing provider fallback." },
    ],
    video: [
      { provider: "google", model: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite", priceLabel: "$0.64 / 8s 1080p", reason: "Excellent production value at a predictable fixed eight-second cost." },
      { provider: "fal", model: "balanced_video", label: "fal balanced video route", priceLabel: "configured marketplace quote", reason: "Optional marketplace fallback." },
      { provider: "higgsfield", model: "seedance_2_0", label: "Seedance 2.0", priceLabel: "Higgsfield credit quote", reason: "Continuity-capable existing fallback." },
    ],
  },
  premium: {
    image: [
      { provider: "google", model: "gemini-3.1-flash-image", label: "Nano Banana 2 · 2K", priceLabel: "about $0.101 / image", reason: "High brand fidelity with many reference images." },
      { provider: "bfl", model: "flux-2-max", label: "FLUX.2 Max", priceLabel: "from $0.07 / MP", reason: "Highest-quality BFL image fallback." },
      { provider: "higgsfield", model: "nano_banana_2", label: "Nano Banana 2 via Higgsfield", priceLabel: "Higgsfield credit quote", reason: "Existing provider fallback." },
    ],
    video: [
      { provider: "higgsfield", model: "auto_premium", label: "Higgsfield Premium Router", priceLabel: "credit quote before generation", reason: "Atlas chooses Seedance 2.5 or Cinema Studio 3.0 from the creative requirements." },
      { provider: "google", model: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", priceLabel: "$0.96 / 8s 1080p", reason: "Predictable premium fallback when Higgsfield is unavailable." },
      { provider: "fal", model: "premium_video", label: "fal premium video route", priceLabel: "configured marketplace quote", reason: "Optional marketplace fallback." },
    ],
  },
};

export function creativeCandidates(preset: CreativePreset, outputKind: CreativeOutputKind) {
  return CANDIDATES[preset][outputKind];
}

export function officialUsdAnchor(input: {
  provider: CreativeProviderId;
  model: string;
  outputKind: CreativeOutputKind;
  resolution: string;
  durationSeconds?: number;
  referenceCount?: number;
}) {
  if (input.provider === "bfl") {
    if (input.model === "flux-2-klein-4b") return { amount: 0.014, exact: false, note: "BFL publishes FLUX.2 Klein from $0.014 per image; megapixels and editing can increase the final amount." };
    if (input.model === "flux-2-pro-preview") return { amount: input.referenceCount ? 0.045 : 0.03, exact: false, note: "BFL publishes FLUX.2 Pro from $0.03 for generation and from $0.045 for editing/reference work." };
    if (input.model === "flux-2-max") return { amount: 0.07, exact: false, note: "FLUX.2 Max starts at $0.07 per megapixel; Atlas shows this as a floor until provider billing metadata is available." };
  }
  if (input.provider === "google") {
    if (input.model === "gemini-3.1-flash-lite-image") return { amount: 0.0336, exact: true, note: "Google paid-tier 1K Nano Banana 2 Lite image price." };
    if (input.model === "gemini-3.1-flash-image") {
      const amount = input.resolution === "4k" ? 0.151 : input.resolution === "720p" ? 0.067 : 0.101;
      return { amount, exact: true, note: `Google paid-tier Nano Banana 2 ${input.resolution === "4k" ? "4K" : input.resolution === "720p" ? "1K" : "2K"} image price.` };
    }
    if (input.model === "veo-3.1-lite-generate-preview") {
      const seconds = 8;
      const perSecond = input.resolution === "1080p" ? 0.08 : 0.05;
      return { amount: Number((seconds * perSecond).toFixed(2)), exact: true, note: `Veo 3.1 Lite is priced per generated second; Atlas requests the fixed 8-second output supported by this route.` };
    }
    if (input.model === "veo-3.1-fast-generate-preview") {
      const seconds = 8;
      const perSecond = input.resolution === "1080p" ? 0.12 : input.resolution === "4k" ? 0.30 : 0.10;
      return { amount: Number((seconds * perSecond).toFixed(2)), exact: true, note: "Google Veo 3.1 Fast paid-tier price multiplied by the fixed 8-second output." };
    }
  }
  if (input.provider === "zai" && input.model.startsWith("vidu2-")) {
    const amount = input.model === "vidu2-reference" ? 0.40 : 0.20;
    return { amount, exact: true, note: "Z.AI publishes Vidu 2 as a flat per-video price for these 720p routes." };
  }
  return null;
}
