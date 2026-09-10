import type { Json } from "@/types/database";
import type { PublishRequest } from "./channel-types";

export const MAX_SOCIAL_ASSET_BYTES = 100 * 1024 * 1024;

export type SocialAsset = { bytes: Buffer; contentType: string };

export function record(value: Json | unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function truthyEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(process.env[name]?.trim().toLowerCase() || "");
}

export function captionFor(request: PublishRequest) {
  return [request.caption, request.attributionUrl].filter(Boolean).join("\n\n").trim();
}

export function isVideoRequest(request: PublishRequest) {
  const metadata = record(request.metadata);
  const mime = typeof metadata.mimeType === "string" ? metadata.mimeType : "";
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("image/")) return false;
  return /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(request.assetUrl || "");
}

export async function readAsset(url: string): Promise<SocialAsset> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download social asset (${response.status}).`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_SOCIAL_ASSET_BYTES) throw new Error("Social asset is larger than Atlas's 100 MB public-media limit.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SOCIAL_ASSET_BYTES) throw new Error("Social asset is larger than Atlas's 100 MB public-media limit.");
  return { bytes, contentType: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
}

export async function jsonOrThrow<T>(response: Response, label: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = record(payload.error);
    const detail = String(error.message ?? payload.message ?? payload.error_description ?? "");
    throw new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  return payload as T;
}
