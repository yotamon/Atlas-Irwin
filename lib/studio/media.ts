import type { Json, MediaAsset } from "@/types/database";

export const MEDIA_TYPES = [
  "cover",
  "alternate_artwork",
  "canvas_video",
  "visualizer",
  "audio_preview",
  "social_image",
  "press_image",
  "lyric_video",
  "content_video",
  "master_audio",
  "stem",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type MediaKind = "image" | "video" | "audio" | "archive" | "unknown";

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  cover: "Release artwork / thumbnail",
  alternate_artwork: "Alternate artwork",
  canvas_video: "Canvas / cover-art video",
  visualizer: "Visualizer",
  audio_preview: "Audio preview",
  social_image: "Social image",
  press_image: "Press image",
  lyric_video: "Lyric video",
  content_video: "Content video",
  master_audio: "Master audio",
  stem: "Stem or production file",
};

const TYPES_BY_KIND: Record<MediaKind, readonly MediaType[]> = {
  image: ["cover", "alternate_artwork", "social_image", "press_image"],
  video: ["canvas_video", "visualizer", "lyric_video", "content_video"],
  audio: ["audio_preview", "master_audio", "stem"],
  archive: ["stem"],
  unknown: [],
};

export function mediaKind(mimeType?: string | null): MediaKind {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType === "application/zip") return "archive";
  return "unknown";
}

export function compatibleMediaTypes(mimeType?: string | null) {
  return TYPES_BY_KIND[mediaKind(mimeType)];
}

export function isCompatibleMediaType(type: string, mimeType?: string | null) {
  return compatibleMediaTypes(mimeType).includes(type as MediaType);
}

export function mediaTypeLabel(type: string) {
  return MEDIA_TYPE_LABELS[type as MediaType] ?? type.replaceAll("_", " ");
}

export type MediaMetadata = {
  originalName: string;
  title: string;
  description: string;
  tags: string[];
  source: string;
};

function metadataRecord(metadata: Json): Record<string, Json | undefined> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
}

export function mediaMetadata(asset: Pick<MediaAsset, "metadata" | "storage_path">): MediaMetadata {
  const metadata = metadataRecord(asset.metadata);
  const originalName = typeof metadata.original_name === "string"
    ? metadata.original_name
    : asset.storage_path.split("/").at(-1) ?? "Untitled asset";
  return {
    originalName,
    title: typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title
      : originalName,
    description: typeof metadata.description === "string" ? metadata.description : "",
    tags: Array.isArray(metadata.tags)
      ? metadata.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    source: typeof metadata.upload_source === "string" ? metadata.upload_source : "upload",
  };
}

export function parseTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

export function defaultMediaType(mimeType?: string | null): MediaType | null {
  return compatibleMediaTypes(mimeType)[0] ?? null;
}

