import { formatVisualBrandPrompt, toVisualBrandPromptContext, type VisualBrandDna } from "./visual-brand-dna";
import type { CreativeGenerationRequest } from "@/lib/marketing/creative-provider-types";
import type { CreativeReference } from "@/lib/marketing/creative-context";

export const VISUAL_BRAND_REFERENCE_PURPOSE_PREFIX = "visual_brand_reference:";
export const VISUAL_BRAND_REFERENCE_PACK_SIZE = 6;

export type VisualBrandReferenceSlot = {
  key: "core_world" | "editorial_identity" | "vertical_world" | "cinematic_world" | "material_study" | "motif_study";
  label: string;
  aspectRatio: CreativeGenerationRequest["aspectRatio"];
  purpose: string;
  direction: string;
};

export function visualBrandReferenceSlots(dna: VisualBrandDna): VisualBrandReferenceSlot[] {
  const people = dna.humanRepresentation.usage !== "none";
  const editorialDirection = people
    ? `Create an editorial image with a human presence treated exactly according to this identity: ${dna.humanRepresentation.treatment.join(", ") || "natural, art-directed, non-generic"}. The person is part of the visual world, not a stock-model hero shot.`
    : "Create an editorial identity image built around environment, object, light and material. Do not introduce a person.";

  return [
    {
      key: "core_world",
      label: "Core world",
      aspectRatio: "1:1",
      purpose: "The clearest single-frame expression of the artist's visual identity.",
      direction: "Create one iconic square composition that feels like the visual world itself, not a release cover and not an ad. Balance signature motifs, palette, material and lighting without turning the image into a collage of every brand element.",
    },
    {
      key: "editorial_identity",
      label: people ? "Editorial identity" : "Editorial environment",
      aspectRatio: "4:5",
      purpose: people ? "A portrait-oriented editorial interpretation of the identity." : "A portrait-oriented environment/object interpretation of the identity.",
      direction: editorialDirection,
    },
    {
      key: "vertical_world",
      label: "Vertical world",
      aspectRatio: "9:16",
      purpose: "A native vertical visual world that can seed Stories, Reels and short-form creative.",
      direction: "Compose a vertical scene with strong depth and intentional negative space. It should survive motion development later, but this output is a still image. Avoid UI, captions, poster text or fake social-media framing.",
    },
    {
      key: "cinematic_world",
      label: "Cinematic world",
      aspectRatio: "16:9",
      purpose: "A wide cinematic interpretation useful for video language and website/editorial surfaces.",
      direction: "Create a wide cinematic frame with spatial storytelling, deliberate lighting and a strong foreground/background relationship. Preserve the identity while expanding its world rather than simply cropping the square concept.",
    },
    {
      key: "material_study",
      label: "Material & texture study",
      aspectRatio: "1:1",
      purpose: "A reusable material, surface and texture anchor for future creative direction.",
      direction: `Create a close visual study of the identity's material and texture language: ${[...dna.textures.primary, ...dna.materials].slice(0, 8).join(", ")}. Keep it art-directed and distinctive, not a generic texture swatch or mood-board grid.`,
    },
    {
      key: "motif_study",
      label: "Motif system",
      aspectRatio: "1:1",
      purpose: "An abstract/graphic exploration of the signature visual motifs without becoming a logo exercise.",
      direction: `Explore the signature motifs as one coherent visual system: ${dna.motifs.signature.map((motif) => `${motif.name} (${motif.guidance})`).join("; ")}. Use selective variation and rhythm. Do not place readable typography, logos or brand marks unless they are already intrinsic to the evidence.`,
    },
  ];
}

export function visualBrandReferencePrompt(dna: VisualBrandDna, slot: VisualBrandReferenceSlot) {
  return [
    formatVisualBrandPrompt(toVisualBrandPromptContext(dna)),
    `Reference-pack role: ${slot.label}. ${slot.purpose}`,
    `Specific direction: ${slot.direction}`,
    "Create an original image that belongs to the identity. Use supplied references as visual lineage, not as compositions to copy. Do not reproduce a source image, recognizable third-party artwork, watermarks or unrelated logos.",
    "This is a visual reference for an artist system, not finished promotional collateral. No readable marketing copy, mockup frames, grids, mood-board layouts or generic AI-gloss aesthetics.",
  ].join("\n");
}

export function visualBrandRouteReferenceContext(references: CreativeReference[]) {
  return {
    imageReferences: references,
    videoReferences: [],
    audioReferenceUrl: null,
  };
}
