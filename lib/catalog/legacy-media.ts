import { existsSync } from "node:fs";
import path from "node:path";

export const CANVAS_VIDEO_FILES = ["canvas.mp4", "canvas.webm", "canvas.mov"] as const;

export function resolveLegacyCanvasVideoUrl(slug: string): string | undefined {
  const releaseDir = path.join(process.cwd(), "public", "releases", slug);
  for (const file of CANVAS_VIDEO_FILES) {
    if (existsSync(path.join(releaseDir, file))) {
      return `/releases/${slug}/${file}`;
    }
  }
  return undefined;
}

export function isCanvasVideoFile(relativePath: string) {
  return CANVAS_VIDEO_FILES.includes(
    path.basename(relativePath).toLowerCase() as (typeof CANVAS_VIDEO_FILES)[number],
  );
}
