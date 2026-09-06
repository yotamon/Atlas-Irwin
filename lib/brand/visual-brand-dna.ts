import { z } from "zod";
import type { Json } from "@/types/database";

const stringList = z.array(z.string().trim().min(1).max(120)).max(16);
const confidence = z.number().min(0).max(1);

export const visualBrandColorSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["base", "primary", "secondary", "accent", "neutral"]),
  usage: z.string().trim().min(1).max(240),
  weight: z.number().min(0).max(1),
});

const motifSchema = z.object({
  name: z.string().trim().min(1).max(100),
  guidance: z.string().trim().min(1).max(280),
});

const typographySchema = z.object({
  style: stringList,
  guidance: z.string().trim().max(400),
});

export const visualBrandDnaSchema = z.object({
  version: z.literal("visual-brand-dna-v1"),
  thesis: z.string().trim().min(12).max(600),
  personality: stringList.min(3),
  emotionalCore: stringList.min(2),
  spectrum: z.object({
    minimalMaximal: confidence,
    organicGeometric: confidence,
    analogDigital: confidence,
    intimateExpansive: confidence,
    darkBright: confidence,
    rawPolished: confidence,
  }),
  colors: z.array(visualBrandColorSchema).min(3).max(12),
  typography: z.object({
    display: typographySchema,
    supporting: typographySchema,
  }),
  motifs: z.object({
    signature: z.array(motifSchema).min(1).max(8),
    supporting: z.array(motifSchema).max(10),
    optional: z.array(motifSchema).max(10),
  }),
  shapes: z.object({ primary: stringList, secondary: stringList, avoid: stringList }),
  textures: z.object({ primary: stringList, secondary: stringList, avoid: stringList }),
  materials: stringList,
  composition: z.object({
    focalStrategy: z.string().trim().max(300),
    density: z.string().trim().max(160),
    negativeSpace: z.string().trim().max(240),
    depth: z.string().trim().max(240),
    preferredFraming: stringList,
  }),
  lighting: stringList,
  photography: z.object({
    confidence,
    guidance: z.string().trim().max(600),
    traits: stringList,
  }),
  humanRepresentation: z.object({
    usage: z.enum(["none", "rare", "regular", "central"]),
    treatment: stringList,
    avoid: stringList,
  }),
  mood: z.object({ core: stringList, allowed: stringList, rare: stringList, avoid: stringList }),
  antiStyle: stringList.min(2),
  continuityRules: stringList.min(2),
  creativeFreedom: confidence,
  fieldConfidence: z.object({
    palette: confidence,
    motifs: confidence,
    texture: confidence,
    composition: confidence,
    typography: confidence,
    photography: confidence,
    overall: confidence,
  }),
});

export type VisualBrandDna = z.infer<typeof visualBrandDnaSchema>;

export type VisualBrandAnalysis = {
  summary: string;
  evidenceQuality: "weak" | "moderate" | "strong";
  discoveries: string[];
  clusters: Array<{
    name: string;
    description: string;
    role: "core" | "supporting" | "experimental" | "exclude";
    assetIds: string[];
  }>;
  sourceNotes: Array<{
    assetId: string;
    relationship: "official" | "inspiration" | "experimental" | "avoid";
    contribution: string;
  }>;
};

export type VisualBrandPromptContext = {
  thesis: string;
  palette: string[];
  signatureMotifs: string[];
  supportingMotifs: string[];
  textures: string[];
  materials: string[];
  composition: string;
  lighting: string[];
  humanTreatment: string[];
  antiStyle: string[];
  continuityRules: string[];
  creativeFreedom: number;
};

export function parseVisualBrandDna(value: Json | unknown): VisualBrandDna | null {
  const parsed = visualBrandDnaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toVisualBrandPromptContext(dna: VisualBrandDna): VisualBrandPromptContext {
  return {
    thesis: dna.thesis,
    palette: dna.colors.map((color) => `${color.name} ${color.hex} (${color.role}: ${color.usage})`),
    signatureMotifs: dna.motifs.signature.map((motif) => `${motif.name}: ${motif.guidance}`),
    supportingMotifs: dna.motifs.supporting.map((motif) => `${motif.name}: ${motif.guidance}`),
    textures: [...dna.textures.primary, ...dna.textures.secondary],
    materials: dna.materials,
    composition: [dna.composition.focalStrategy, dna.composition.density, dna.composition.negativeSpace, dna.composition.depth].filter(Boolean).join(" "),
    lighting: dna.lighting,
    humanTreatment: [dna.humanRepresentation.usage !== "none" ? `People: ${dna.humanRepresentation.usage}.` : "Do not introduce people by default.", ...dna.humanRepresentation.treatment, ...dna.humanRepresentation.avoid.map((item) => `Avoid ${item}`)],
    antiStyle: dna.antiStyle,
    continuityRules: dna.continuityRules,
    creativeFreedom: dna.creativeFreedom,
  };
}

export function formatVisualBrandPrompt(context: VisualBrandPromptContext) {
  return [
    `Visual identity thesis: ${context.thesis}`,
    `Palette system: ${context.palette.join("; ")}`,
    `Signature motifs: ${context.signatureMotifs.join("; ")}`,
    context.supportingMotifs.length ? `Supporting motifs: ${context.supportingMotifs.join("; ")}` : "",
    context.textures.length ? `Texture language: ${context.textures.join(", ")}` : "",
    context.materials.length ? `Material language: ${context.materials.join(", ")}` : "",
    context.composition ? `Composition language: ${context.composition}` : "",
    context.lighting.length ? `Lighting language: ${context.lighting.join(", ")}` : "",
    context.humanTreatment.length ? `Human representation: ${context.humanTreatment.join("; ")}` : "",
    `Continuity rules: ${context.continuityRules.join("; ")}`,
    `Anti-style: ${context.antiStyle.join("; ")}`,
    `Creative freedom: ${Math.round(context.creativeFreedom * 100)}%. Preserve identity while varying concept and composition; do not mechanically repeat the same motif combination.`,
  ].filter(Boolean).join("\n");
}
