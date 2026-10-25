"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  animateApprovedReleaseVisual,
  saveReleaseVisualDerivative,
} from "@/app/studio/release-visual-actions";
import { renderReleaseVisual } from "@/components/studio/release-visual-composer";
import type { ReleaseVisualSpec } from "@/lib/marketing/release-visual";

export function ReleaseVisualAnimateButton({
  artistId,
  contentItemId,
  approvedSpec,
  storyReady,
}: {
  artistId: string;
  contentItemId: string;
  approvedSpec: ReleaseVisualSpec;
  storyReady: boolean;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        if (!storyReady) {
          const canvas = canvasRef.current;
          if (!canvas) throw new Error("Could not initialize the Story renderer.");
          const storySpec = { ...approvedSpec, primaryPackageId: "instagram-story-image" as const };
          await renderReleaseVisual(canvas, storySpec);
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((result) => {
              if (result) resolve(result);
              else reject(new Error("The Story source could not be encoded."));
            }, "image/png");
          });
          const derivative = new FormData();
          derivative.set("artist_id", artistId);
          derivative.set("content_item_id", contentItemId);
          derivative.set("spec_json", JSON.stringify(storySpec));
          derivative.set("rendered_png", new File([blob], "release-visual-story.png", { type: "image/png" }));
          await saveReleaseVisualDerivative(derivative);
        }

        const form = new FormData();
        form.set("artist_id", artistId);
        form.set("content_item_id", contentItemId);
        const result = await animateApprovedReleaseVisual(form);
        router.push(result.href);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not start Living Artwork.");
      }
    });
  }

  return (
    <div className="release-visual-animate-action">
      <canvas ref={canvasRef} className="release-visual-offscreen-canvas" aria-hidden />
      <button className="button primary" type="button" onClick={start} disabled={pending}>
        {pending ? (storyReady ? "Opening Living Artwork…" : "Preparing Story source…") : "Animate this artwork"}
      </button>
      <small>Uses the approved 9:16 composition as the exact first and last frame source.</small>
      {error ? <p className="ensemblis-notice" data-tone="danger" role="alert">{error}</p> : null}
    </div>
  );
}
