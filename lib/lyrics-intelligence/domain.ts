import type { Json } from "@/types/database";
import type { LyricSectionType, LyricsAnalysisPayload } from "@/types/lyrics-database";

export const LYRICS_PROMPT_VERSION = "lyrics-intelligence-v1";

export type ParsedLyricLine = {
  display_order: number;
  text: string;
  allow_media: boolean;
};

export type ParsedLyricSection = {
  section_key: string;
  section_type: LyricSectionType;
  label: string;
  display_order: number;
  text: string;
  structure_source: "manual" | "parser";
  confidence: number | null;
  is_primary_hook: boolean;
  allow_media: boolean;
  lines: ParsedLyricLine[];
};

const SECTION_LABELS: Array<[RegExp, LyricSectionType, string]> = [
  [/^intro(?:\s+\d+)?$/i, "intro", "Intro"],
  [/^verse(?:\s+\d+)?$/i, "verse", "Verse"],
  [/^(?:pre[\s-]?chorus|pre)(?:\s+\d+)?$/i, "pre_chorus", "Pre-Chorus"],
  [/^chorus(?:\s+\d+)?$/i, "chorus", "Chorus"],
  [/^post[\s-]?chorus(?:\s+\d+)?$/i, "post_chorus", "Post-Chorus"],
  [/^bridge(?:\s+\d+)?$/i, "bridge", "Bridge"],
  [/^refrain(?:\s+\d+)?$/i, "refrain", "Refrain"],
  [/^hook(?:\s+\d+)?$/i, "hook", "Hook"],
  [/^outro(?:\s+\d+)?$/i, "outro", "Outro"],
];

function cleanText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function normalizeBlock(value: string) {
  return cleanText(value).replace(/\s+/g, " ").toLocaleLowerCase();
}

function sectionFromLabel(raw: string) {
  const value = raw.replace(/^\[|\]$/g, "").replace(/:$/, "").trim();
  for (const [pattern, type, fallback] of SECTION_LABELS) {
    if (pattern.test(value)) return { type, label: value || fallback };
  }
  return { type: "other" as const, label: value || "Section" };
}

function header(line: string) {
  const trimmed = line.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)\]$/);
  if (bracketed) return sectionFromLabel(bracketed[1]);
  const plain = sectionFromLabel(trimmed);
  return plain.type !== "other" ? plain : null;
}

function keyFor(type: LyricSectionType, count: number) {
  return `${type === "other" ? "section" : type}_${count}`;
}

function linesFor(text: string): ParsedLyricLine[] {
  return cleanText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ display_order: index, text: line, allow_media: true }));
}

function repeatedTypes(blocks: string[]) {
  const frequencies = new Map<string, number>();
  for (const block of blocks) {
    const key = normalizeBlock(block);
    if (key) frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  return frequencies;
}

export function parseLyrics(canonicalText: string): ParsedLyricSection[] {
  const text = cleanText(canonicalText);
  if (!text) return [];
  const rows = text.split("\n");
  const hasHeaders = rows.some((row) => Boolean(header(row)));
  const drafts: Array<{ type: LyricSectionType; label: string; text: string; source: "manual" | "parser" }> = [];

  if (hasHeaders) {
    let current: { type: LyricSectionType; label: string; lines: string[] } | null = null;
    const flush = () => {
      if (!current) return;
      const body = cleanText(current.lines.join("\n"));
      if (body) drafts.push({ type: current.type, label: current.label, text: body, source: "manual" });
    };
    for (const row of rows) {
      const parsedHeader = header(row);
      if (parsedHeader) {
        flush();
        current = { type: parsedHeader.type, label: parsedHeader.label, lines: [] };
      } else if (current) {
        current.lines.push(row);
      } else if (row.trim()) {
        current = { type: "other", label: "Opening", lines: [row] };
      }
    }
    flush();
  } else {
    const blocks = text.split(/\n\s*\n+/).map(cleanText).filter(Boolean);
    const frequencies = repeatedTypes(blocks);
    blocks.forEach((block, index) => {
      const repeated = (frequencies.get(normalizeBlock(block)) ?? 0) > 1;
      const type: LyricSectionType = repeated ? "chorus" : "other";
      drafts.push({
        type,
        label: repeated ? "Chorus" : `Section ${index + 1}`,
        text: block,
        source: "parser",
      });
    });
  }

  const counts = new Map<LyricSectionType, number>();
  return drafts.map((draft, index) => {
    const count = (counts.get(draft.type) ?? 0) + 1;
    counts.set(draft.type, count);
    return {
      section_key: keyFor(draft.type, count),
      section_type: draft.type,
      label: draft.label,
      display_order: index,
      text: draft.text,
      structure_source: draft.source,
      confidence: draft.source === "manual" ? 1 : draft.type === "chorus" ? 0.72 : null,
      is_primary_hook: false,
      allow_media: true,
      lines: linesFor(draft.text),
    };
  });
}

export function normalizeExcerpt(value: string) {
  return value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function excerptExists(excerpt: string, canonicalText: string) {
  const needle = normalizeExcerpt(excerpt);
  return Boolean(needle) && normalizeExcerpt(canonicalText).includes(needle);
}

export function asLyricsAnalysis(value: Json | unknown): LyricsAnalysisPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<LyricsAnalysisPayload>;
  if (typeof record.summary !== "string" || !Array.isArray(record.themes) || !Array.isArray(record.moments)) return null;
  return record as LyricsAnalysisPayload;
}

export const LYRICS_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "language", "summary", "core_meaning", "themes", "emotional_arc", "imagery", "motifs",
    "perspective", "chorus_meaning", "hook_phrases", "visual_opportunities", "content_angles",
    "section_annotations", "moments",
  ],
  properties: {
    language: { type: "string" },
    summary: { type: "string" },
    core_meaning: { type: "string" },
    themes: { type: "array", maxItems: 8, items: { type: "string" } },
    emotional_arc: {
      type: "array", maxItems: 8,
      items: { type: "object", additionalProperties: false, required: ["stage", "description"], properties: { stage: { type: "string" }, description: { type: "string" } } },
    },
    imagery: { type: "array", maxItems: 12, items: { type: "string" } },
    motifs: { type: "array", maxItems: 10, items: { type: "string" } },
    perspective: { type: "string" },
    chorus_meaning: { type: "string" },
    hook_phrases: {
      type: "array", maxItems: 8,
      items: {
        type: "object", additionalProperties: false, required: ["text", "reason", "score"],
        properties: { text: { type: "string" }, reason: { type: "string" }, score: { type: "number", minimum: 0, maximum: 1 } },
      },
    },
    visual_opportunities: {
      type: "array", maxItems: 8,
      items: {
        type: "object", additionalProperties: false, required: ["idea", "lyric_reference", "treatment"],
        properties: { idea: { type: "string" }, lyric_reference: { type: "string" }, treatment: { type: "string" } },
      },
    },
    content_angles: {
      type: "array", maxItems: 8,
      items: {
        type: "object", additionalProperties: false, required: ["title", "angle", "lyric_reference"],
        properties: { title: { type: "string" }, angle: { type: "string" }, lyric_reference: { type: "string" } },
      },
    },
    section_annotations: {
      type: "array", maxItems: 30,
      items: {
        type: "object", additionalProperties: false,
        required: ["section_key", "section_type", "label", "confidence", "is_primary_hook"],
        properties: {
          section_key: { type: "string" },
          section_type: { type: "string", enum: ["intro","verse","pre_chorus","chorus","post_chorus","bridge","refrain","hook","outro","other"] },
          label: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          is_primary_hook: { type: "boolean" },
        },
      },
    },
    moments: {
      type: "array", maxItems: 10,
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "excerpt", "section_key", "interpretation", "purpose_tags", "visual_directions", "score"],
        properties: {
          title: { type: "string" }, excerpt: { type: "string" }, section_key: { type: "string" }, interpretation: { type: "string" },
          purpose_tags: { type: "array", maxItems: 8, items: { type: "string" } },
          visual_directions: { type: "array", maxItems: 8, items: { type: "string" } },
          score: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};