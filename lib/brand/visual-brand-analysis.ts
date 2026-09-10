import "server-only";

import { generateGatewayVisionStructured } from "@/lib/ai/gateway-vision";
import { parseGatewayModelList } from "@/lib/ai/gateway";
import { visualBrandDnaSchema, type VisualBrandAnalysis, type VisualBrandDna } from "./visual-brand-dna";

export type VisualBrandEvidence = {
  assetId: string;
  url: string;
  title: string;
  relationship: "official" | "inspiration" | "experimental" | "avoid";
};

const strings = (maxItems = 16) => ({
  type: "array",
  maxItems,
  items: { type: "string", minLength: 1, maxLength: 280 },
});

const motif = {
  type: "object",
  additionalProperties: false,
  required: ["name", "guidance"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    guidance: { type: "string", minLength: 1, maxLength: 280 },
  },
};

const typography = {
  type: "object",
  additionalProperties: false,
  required: ["style", "guidance"],
  properties: {
    style: strings(12),
    guidance: { type: "string", maxLength: 400 },
  },
};

const dnaSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version", "thesis", "personality", "emotionalCore", "spectrum", "colors", "typography", "motifs", "shapes",
    "textures", "materials", "composition", "lighting", "photography", "humanRepresentation", "mood", "antiStyle",
    "continuityRules", "creativeFreedom", "fieldConfidence",
  ],
  properties: {
    version: { type: "string", const: "visual-brand-dna-v1" },
    thesis: { type: "string", minLength: 12, maxLength: 600 },
    personality: strings(12),
    emotionalCore: strings(10),
    spectrum: {
      type: "object",
      additionalProperties: false,
      required: ["minimalMaximal", "organicGeometric", "analogDigital", "intimateExpansive", "darkBright", "rawPolished"],
      properties: Object.fromEntries(["minimalMaximal", "organicGeometric", "analogDigital", "intimateExpansive", "darkBright", "rawPolished"].map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])),
    },
    colors: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hex", "name", "role", "usage", "weight"],
        properties: {
          hex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          name: { type: "string", minLength: 1, maxLength: 80 },
          role: { type: "string", enum: ["base", "primary", "secondary", "accent", "neutral"] },
          usage: { type: "string", minLength: 1, maxLength: 240 },
          weight: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    typography: {
      type: "object",
      additionalProperties: false,
      required: ["display", "supporting"],
      properties: { display: typography, supporting: typography },
    },
    motifs: {
      type: "object",
      additionalProperties: false,
      required: ["signature", "supporting", "optional"],
      properties: {
        signature: { type: "array", minItems: 1, maxItems: 8, items: motif },
        supporting: { type: "array", maxItems: 10, items: motif },
        optional: { type: "array", maxItems: 10, items: motif },
      },
    },
    shapes: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "avoid"],
      properties: { primary: strings(12), secondary: strings(12), avoid: strings(12) },
    },
    textures: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "avoid"],
      properties: { primary: strings(12), secondary: strings(12), avoid: strings(12) },
    },
    materials: strings(14),
    composition: {
      type: "object",
      additionalProperties: false,
      required: ["focalStrategy", "density", "negativeSpace", "depth", "preferredFraming"],
      properties: {
        focalStrategy: { type: "string", maxLength: 300 },
        density: { type: "string", maxLength: 160 },
        negativeSpace: { type: "string", maxLength: 240 },
        depth: { type: "string", maxLength: 240 },
        preferredFraming: strings(10),
      },
    },
    lighting: strings(12),
    photography: {
      type: "object",
      additionalProperties: false,
      required: ["confidence", "guidance", "traits"],
      properties: {
        confidence: { type: "number", minimum: 0, maximum: 1 },
        guidance: { type: "string", maxLength: 600 },
        traits: strings(12),
      },
    },
    humanRepresentation: {
      type: "object",
      additionalProperties: false,
      required: ["usage", "treatment", "avoid"],
      properties: {
        usage: { type: "string", enum: ["none", "rare", "regular", "central"] },
        treatment: strings(12),
        avoid: strings(12),
      },
    },
    mood: {
      type: "object",
      additionalProperties: false,
      required: ["core", "allowed", "rare", "avoid"],
      properties: { core: strings(10), allowed: strings(12), rare: strings(8), avoid: strings(10) },
    },
    antiStyle: strings(16),
    continuityRules: strings(14),
    creativeFreedom: { type: "number", minimum: 0, maximum: 1 },
    fieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: ["palette", "motifs", "texture", "composition", "typography", "photography", "overall"],
      properties: Object.fromEntries(["palette", "motifs", "texture", "composition", "typography", "photography", "overall"].map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])),
    },
  },
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dna", "analysis"],
  properties: {
    dna: dnaSchema,
    analysis: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "evidenceQuality", "discoveries", "clusters", "sourceNotes"],
      properties: {
        summary: { type: "string", minLength: 12, maxLength: 900 },
        evidenceQuality: { type: "string", enum: ["weak", "moderate", "strong"] },
        discoveries: strings(12),
        clusters: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "description", "role", "assetIds"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 100 },
              description: { type: "string", minLength: 1, maxLength: 500 },
              role: { type: "string", enum: ["core", "supporting", "experimental", "exclude"] },
              assetIds: strings(12),
            },
          },
        },
        sourceNotes: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["assetId", "relationship", "contribution"],
            properties: {
              assetId: { type: "string", minLength: 1, maxLength: 80 },
              relationship: { type: "string", enum: ["official", "inspiration", "experimental", "avoid"] },
              contribution: { type: "string", minLength: 1, maxLength: 400 },
            },
          },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

const instructions = `You are Ensemblis Visual Brand Intelligence, a senior music-art creative director and identity-system designer.
Your job is not to describe images individually. Infer a reusable visual identity system for one artist from multiple visual references.

Evidence semantics matter:
- official = strongest evidence of what the artist already is;
- inspiration = direction the artist wants more of, but never copy another creator literally;
- experimental = possible evolution, lower weight than official;
- avoid = negative reference. Extract what should NOT enter the identity.

Build one coherent identity thesis and a structured system that can guide future cover art, social media, posters, video frames and photography. Distinguish enduring identity from accidental details in one image. Prefer patterns repeated across strong evidence. Do not force every motif into every output. A good identity creates family resemblance while preserving creative range.

Be especially strict about anti-style: identify generic AI aesthetics, visual clichés or recurring treatments that would make the artist look interchangeable. Typography guidance describes direction, not invented font names unless the evidence clearly supports them. If photography evidence is weak, say so through low photography confidence instead of hallucinating a photography language.

The output is production data, not marketing copy. Keep wording concrete, art-directable and model-usable.`;

function chooseEvidence(evidence: VisualBrandEvidence[]) {
  const byRelationship = (relationship: VisualBrandEvidence["relationship"]) => evidence.filter((item) => item.relationship === relationship);
  const selected = [
    ...byRelationship("official").slice(0, 6),
    ...byRelationship("inspiration").slice(0, 2),
    ...byRelationship("experimental").slice(0, 1),
    ...byRelationship("avoid").slice(0, 1),
  ];
  if (selected.length >= 3) return Array.from(new Map(selected.map((item) => [item.assetId, item])).values()).slice(0, 8);
  return evidence.slice(0, 8);
}

export async function analyzeVisualBrandEvidence(input: {
  artistName: string;
  evidence: VisualBrandEvidence[];
  maturity: "starting" | "emerging" | "established";
  useCases: string[];
}) {
  const selected = chooseEvidence(input.evidence);
  if (selected.length < 3) throw new Error("Add at least three public image references before building Visual Brand DNA.");
  const model = process.env.ENSEMBLIS_BRAND_VISION_MODEL?.trim()
    || process.env.ENSEMBLIS_CREATIVE_REVIEW_MODEL?.trim()
    || process.env.ATLAS_CREATIVE_REVIEW_MODEL?.trim()
    || "openai/gpt-5.6-terra";
  const fallbackModels = parseGatewayModelList(
    process.env.ENSEMBLIS_BRAND_VISION_FALLBACK_MODELS
      || process.env.ENSEMBLIS_CREATIVE_REVIEW_FALLBACK_MODELS
      || process.env.ATLAS_CREATIVE_REVIEW_FALLBACK_MODELS,
  );
  const manifest = selected.map((item, index) => ({
    image: index + 1,
    assetId: item.assetId,
    title: item.title,
    relationship: item.relationship,
  }));
  const result = await generateGatewayVisionStructured<{ dna: VisualBrandDna; analysis: VisualBrandAnalysis }>({
    name: "ensemblis_visual_brand_dna",
    schema: responseSchema,
    instructions,
    prompt: JSON.stringify({
      artist: input.artistName,
      maturity: input.maturity,
      intendedUses: input.useCases,
      evidenceManifest: manifest,
      task: "Synthesize a durable visual identity system. Use assetIds exactly as supplied when assigning clusters and source notes.",
    }),
    imageUrls: selected.map((item) => item.url),
    model,
    fallbackModels,
    timeoutMs: 120_000,
  });
  const dna = visualBrandDnaSchema.parse(result.value.dna);
  return { dna, analysis: result.value.analysis, evidence: selected, model: result.model, requestId: result.requestId };
}
