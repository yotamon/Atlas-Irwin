"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReleaseVisualDerivative } from "@/app/studio/release-visual-actions";
import { renderReleaseVisual } from "@/components/studio/release-visual-composer";
import {
  RELEASE_VISUAL_PACKAGE_IDS,
  type ReleaseVisualPackageId,
  type ReleaseVisualSpec,
} from "@/lib/marketing/release-visual";

const LABELS: Record<ReleaseVisualPackageId, string> = {
  "instagram-story-image": "Story · 9:16",
  "instagram-feed-portrait": "Feed · 4:5",
  "instagram-square": "Square · 1:1",
};

export function ReleaseVisualFormatRenderer({
  artistId,
  contentItemId,
  approvedSpec,
  assets,
}: {
  artistId: string;
  contentItemId: string;
  approvedSpec: ReleaseVisualSpec;
  assets: Partial<Record<ReleaseVisualPackageId, string>>;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState<ReleaseVisualPackageId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function render(packageId: ReleaseVisualPackageId) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setActive(packageId);
    setError(null);
    startTransition(async () => {
      try {
        const spec = { ...approvedSpec, primaryPackageId: packageId };
        await renderReleaseVisual(canvas, spec);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error("The social-format PNG could not be encoded."));
          }, "image/png");
        });
        const form = new FormData();
        form.set("artist_id", artistId);
        form.set("content_item_id", contentItemId);
        form.set("spec_json", JSON.stringify(spec));
        form.set("rendered_png", new File([blob], "release-visual-derivative.png", { type: "image/png" }));
        await saveReleaseVisualDerivative(form);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not render this social format.");
      } finally {
        setActive(null);
      }
    });
  }

  return (
    <div className="release-visual-format-renderer" id="release-visual-formats">
      <canvas ref={canvasRef} className="release-visual-offscreen-canvas" aria-hidden />
      <div className="release-visual-format-grid">
        {RELEASE_VISUAL_PACKAGE_IDS.map((packageId) => {
          const url = assets[packageId];
          return (
            <article key={packageId}>
              <strong>{LABELS[packageId]}</strong>
              <small>{packageId === approvedSpec.primaryPackageId ? "Approved primary" : "Same approved design · recomposed"}</small>
              {url ? (
                <a className="button" href={url} target="_blank" rel="noreferrer">Open</a>
              ) : (
                <button
                  className="button"
                  type="button"
                  disabled={pending}
                  onClick={() => render(packageId)}
                >
                  {active === packageId ? "Rendering…" : "Create format"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {error ? <p className="ensemblis-notice" data-tone="danger" role="alert">{error}</p> : null}
    </div>
  );
}
