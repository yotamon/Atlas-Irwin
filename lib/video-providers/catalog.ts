import {
  HIGGSFIELD_MODELS,
  type HiggsfieldModelCapability,
} from "./higgsfield/catalog";

export type VideoProviderId = "higgsfield";

export type VideoModelOffer = HiggsfieldModelCapability & {
  provider: VideoProviderId;
  providerLabel: string;
};

export const VIDEO_MODEL_OFFERS: readonly VideoModelOffer[] = HIGGSFIELD_MODELS.map((model) => ({
  ...model,
  provider: "higgsfield" as const,
  providerLabel: "Higgsfield",
}));

export function videoModelOffer(provider: string | null | undefined, model: string | null | undefined) {
  if (!model) return null;
  return VIDEO_MODEL_OFFERS.find((item) => item.id === model && (!provider || item.provider === provider))
    ?? VIDEO_MODEL_OFFERS.find((item) => item.id === model)
    ?? null;
}

export function videoModelDisplay(provider: string | null | undefined, model: string | null | undefined) {
  const offer = videoModelOffer(provider, model);
  if (!offer) {
    return {
      model: model || "Unknown model",
      provider: provider || "Unknown provider",
      modelLabel: model || "Unknown model",
      providerLabel: provider || "Unknown provider",
    };
  }
  return {
    model: offer.id,
    provider: offer.provider,
    modelLabel: offer.label,
    providerLabel: offer.providerLabel,
  };
}
