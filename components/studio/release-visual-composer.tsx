"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReleaseVisualCandidate } from "@/app/studio/release-visual-actions";
import { releaseVisualLayoutPlan } from "@/lib/marketing/release-visual-layout";
import { socialPlatformPackages } from "@/lib/marketing/platform-packages";
import {
  RELEASE_VISUAL_LAYOUTS,
  RELEASE_VISUAL_PACKAGE_IDS,
  type ReleaseVisualCopy,
  type ReleaseVisualLayoutId,
  type ReleaseVisualPackageId,
  type ReleaseVisualSpec,
} from "@/lib/marketing/release-visual";

const LAYOUT_LABELS: Record<ReleaseVisualLayoutId, { title: string; detail: string }> = {
  cover_focus: {
    title: "Cover focus",
    detail: "Keep the cover complete and extend its visual atmosphere around it.",
  },
  editorial_split: {
    title: "Editorial split",
    detail: "Give promotional copy a deliberate editorial zone beside the artwork.",
  },
  full_bleed: {
    title: "Full bleed",
    detail: "Let the artwork fill the frame with protected typography over it.",
  },
  minimal_frame: {
    title: "Minimal frame",
    detail: "Maximum respect for strong cover art with restrained supporting type.",
  },
};

const PACKAGE_LABELS: Record<ReleaseVisualPackageId, string> = {
  "instagram-story-image": "Story · 9:16",
  "instagram-feed-portrait": "Feed · 4:5",
  "instagram-square": "Square · 1:1",
};

function drawCover(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function averageColor(image: ImageBitmap) {
  const sample = document.createElement("canvas");
  sample.width = 1;
  sample.height = 1;
  const context = sample.getContext("2d");
  if (!context) return [24, 24, 24] as const;
  context.drawImage(image, 0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b] as const;
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || context.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type TextEntry = {
  text: string;
  size: number;
  weight: number;
  tracking: number;
  maxLines: number;
  marginAfter: number;
};

function textEntries(copy: ReleaseVisualCopy): TextEntry[] {
  return [
    copy.headline ? { text: copy.headline, size: 88, weight: 800, tracking: 1.4, maxLines: 2, marginAfter: 22 } : null,
    copy.title ? { text: copy.title, size: 54, weight: 750, tracking: 0, maxLines: 3, marginAfter: 12 } : null,
    copy.artistName ? { text: copy.artistName, size: 30, weight: 650, tracking: 0.5, maxLines: 2, marginAfter: 16 } : null,
    copy.dateLabel ? { text: copy.dateLabel, size: 29, weight: 650, tracking: 0.8, maxLines: 2, marginAfter: 14 } : null,
    copy.supportingLine ? { text: copy.supportingLine, size: 27, weight: 500, tracking: 0, maxLines: 3, marginAfter: 16 } : null,
    copy.cta ? { text: copy.cta, size: 25, weight: 700, tracking: 0.4, maxLines: 2, marginAfter: 0 } : null,
  ].filter((entry): entry is TextEntry => Boolean(entry));
}

function measuredTextBlock(input: {
  context: CanvasRenderingContext2D;
  copy: ReleaseVisualCopy;
  width: number;
  height: number;
  fontFamily: string;
}) {
  const entries = textEntries(input.copy);
  for (let scale = 1; scale >= 0.54; scale -= 0.04) {
    const measured = entries.map((entry) => {
      const fontSize = Math.round(entry.size * scale);
      input.context.font = `${entry.weight} ${fontSize}px ${input.fontFamily}`;
      const lines = wrapLines(input.context, entry.text, input.width);
      const lineHeight = Math.round(fontSize * 1.12);
      return { ...entry, fontSize, lineHeight, lines };
    });
    const invalid = measured.some((entry) => entry.lines.length > entry.maxLines);
    const totalHeight = measured.reduce((sum, entry) =>
      sum + entry.lines.length * entry.lineHeight + Math.round(entry.marginAfter * scale), 0);
    if (!invalid && totalHeight <= input.height) return { measured, totalHeight };
  }
  throw new Error("The promotional copy is too long for this format. Shorten the text or choose another layout.");
}

async function sourceBitmap(url: string) {
  const response = await fetch(url, { cache: "no-store", mode: "cors" });
  if (!response.ok) throw new Error(`Could not load the approved visual source (${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The selected Release Visual source is not an image.");
  return createImageBitmap(blob);
}

export async function renderReleaseVisual(canvas: HTMLCanvasElement, spec: ReleaseVisualSpec) {
  await document.fonts.ready;
  if (document.fonts.status !== "loaded") {
    throw new Error("Ensemblis typography is still loading. Try the render again.");
  }

  const target = socialPlatformPackages().find((item) =>
    item.id === spec.primaryPackageId && item.outputKind === "image"
  );
  if (!target) throw new Error("The selected social format is unavailable.");

  const bitmap = await sourceBitmap(spec.sourceUrl);
  try {
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot render Release Visual artwork.");
    const plan = releaseVisualLayoutPlan({
      layout: spec.layout,
      target,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    });
    const [r, g, b] = averageColor(bitmap);

    context.fillStyle = `rgb(${Math.round(r * 0.32)}, ${Math.round(g * 0.32)}, ${Math.round(b * 0.32)})`;
    context.fillRect(0, 0, target.width, target.height);

    if (spec.backgroundTreatment === "extended_blur") {
      context.save();
      context.filter = "blur(70px) saturate(0.95)";
      drawCover(context, bitmap, -80, -80, target.width + 160, target.height + 160);
      context.restore();
      context.fillStyle = "rgba(0,0,0,0.42)";
      context.fillRect(0, 0, target.width, target.height);
    } else if (spec.backgroundTreatment === "full_bleed") {
      drawCover(context, bitmap, 0, 0, target.width, target.height);
      const gradient = context.createLinearGradient(0, target.height * 0.48, 0, target.height);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0.72)");
      context.fillStyle = gradient;
      context.fillRect(0, target.height * 0.4, target.width, target.height * 0.6);
    }

    if (spec.layout !== "full_bleed") {
      context.drawImage(
        bitmap,
        plan.artwork.x,
        plan.artwork.y,
        plan.artwork.width,
        plan.artwork.height,
      );
      if (spec.layout === "minimal_frame") {
        context.strokeStyle = "rgba(255,255,255,0.55)";
        context.lineWidth = Math.max(2, Math.round(target.width * 0.003));
        context.strokeRect(
          plan.artwork.x - 10,
          plan.artwork.y - 10,
          plan.artwork.width + 20,
          plan.artwork.height + 20,
        );
      }
    }

    if (plan.textOnArtwork) {
      const gradient = context.createLinearGradient(0, plan.textArea.y - 100, 0, plan.textArea.y + plan.textArea.height);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.42, "rgba(0,0,0,0.34)");
      gradient.addColorStop(1, "rgba(0,0,0,0.72)");
      context.fillStyle = gradient;
      context.fillRect(0, Math.max(0, plan.textArea.y - 100), target.width, target.height - Math.max(0, plan.textArea.y - 100));
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const headingVariable = rootStyle.getPropertyValue("--font-heading").trim();
    const bodyFamily = getComputedStyle(document.body).fontFamily;
    const fontFamily = headingVariable || bodyFamily;
    if (!fontFamily) throw new Error("Ensemblis typography is unavailable.");

    const block = measuredTextBlock({
      context,
      copy: spec.copy,
      width: plan.textArea.width,
      height: plan.textArea.height,
      fontFamily,
    });
    const leftAligned = plan.align === "left";
    const x = leftAligned ? plan.textArea.x : plan.textArea.x + plan.textArea.width / 2;
    let y = plan.textArea.y + Math.max(0, (plan.textArea.height - block.totalHeight) / 2);

    context.fillStyle = "#ffffff";
    context.textBaseline = "top";
    context.textAlign = leftAligned ? "left" : "center";

    for (const entry of block.measured) {
      context.font = `${entry.weight} ${entry.fontSize}px ${fontFamily}`;
      for (const line of entry.lines) {
        context.fillText(line, x, y, plan.textArea.width);
        y += entry.lineHeight;
      }
      y += Math.round(entry.marginAfter * (entry.fontSize / entry.size));
    }

    return target;
  } finally {
    bitmap.close();
  }
}

export function ReleaseVisualComposer({
  artistId,
  contentItemId,
  initialSpec,
}: {
  artistId: string;
  contentItemId: string;
  initialSpec: ReleaseVisualSpec;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spec, setSpec] = useState(initialSpec);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pending, startTransition] = useTransition();
  const packages = useMemo(() =>
    socialPlatformPackages().filter((item) =>
      item.outputKind === "image"
      && RELEASE_VISUAL_PACKAGE_IDS.includes(item.id as ReleaseVisualPackageId)
    ), []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setPreviewing(true);
    setError(null);
    renderReleaseVisual(canvas, spec)
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not preview Release Visual.");
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => { cancelled = true; };
  }, [spec]);

  function updateCopy(key: keyof ReleaseVisualCopy, value: string) {
    setSpec((current) => ({
      ...current,
      copy: { ...current.copy, [key]: value || null },
    }));
  }

  function chooseLayout(layout: ReleaseVisualLayoutId) {
    setSpec((current) => ({
      ...current,
      layout,
      backgroundTreatment: layout === "full_bleed"
        ? "full_bleed"
        : layout === "minimal_frame"
          ? "solid"
          : "extended_blur",
      textTreatment: {
        ...current.textTreatment,
        align: layout === "editorial_split" || layout === "full_bleed" ? "left" : "center",
      },
    }));
  }

  function choosePackage(packageId: ReleaseVisualPackageId) {
    setSpec((current) => ({ ...current, primaryPackageId: packageId }));
  }

  function review() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(null);
    startTransition(async () => {
      try {
        await renderReleaseVisual(canvas, spec);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error("The Release Visual PNG could not be encoded."));
          }, "image/png");
        });
        const form = new FormData();
        form.set("artist_id", artistId);
        form.set("content_item_id", contentItemId);
        form.set("spec_json", JSON.stringify(spec));
        form.set("rendered_png", new File([blob], "release-visual.png", { type: "image/png" }));
        await saveReleaseVisualCandidate(form);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not prepare Release Visual for review.");
      }
    });
  }

  return (
    <div className="release-visual-composer">
      <div className="release-visual-composer-preview">
        <canvas ref={canvasRef} aria-label="Release Visual preview" />
        {previewing ? <span className="release-visual-preview-status">Rendering preview…</span> : null}
      </div>

      <div className="release-visual-composer-controls">
        <div>
          <span className="section-label">Format</span>
          <div className="release-visual-choice-grid compact">
            {packages.map((item) => (
              <button
                type="button"
                className={spec.primaryPackageId === item.id ? "release-visual-choice is-selected" : "release-visual-choice"}
                onClick={() => choosePackage(item.id as ReleaseVisualPackageId)}
                key={item.id}
              >
                <strong>{PACKAGE_LABELS[item.id as ReleaseVisualPackageId]}</strong>
                <small>{item.width}×{item.height}</small>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="section-label">Layout</span>
          <div className="release-visual-layout-grid">
            {RELEASE_VISUAL_LAYOUTS.map((layout) => (
              <button
                type="button"
                className={spec.layout === layout ? "release-visual-layout-card is-selected" : "release-visual-layout-card"}
                onClick={() => chooseLayout(layout)}
                key={layout}
              >
                <strong>{LAYOUT_LABELS[layout].title}</strong>
                <small>{LAYOUT_LABELS[layout].detail}</small>
              </button>
            ))}
          </div>
        </div>

        <details className="v2-advanced-disclosure release-visual-copy-edit">
          <summary>Edit exact copy</summary>
          <div className="form-grid">
            <label className="field"><span>Headline</span><input value={spec.copy.headline ?? ""} onChange={(event) => updateCopy("headline", event.target.value)} /></label>
            <label className="field"><span>Date</span><input value={spec.copy.dateLabel ?? ""} onChange={(event) => updateCopy("dateLabel", event.target.value)} /></label>
            <label className="field"><span>Release title</span><input value={spec.copy.title ?? ""} onChange={(event) => updateCopy("title", event.target.value)} /></label>
            <label className="field"><span>Artist</span><input value={spec.copy.artistName ?? ""} onChange={(event) => updateCopy("artistName", event.target.value)} /></label>
            <label className="field wide"><span>Supporting line</span><input value={spec.copy.supportingLine ?? ""} onChange={(event) => updateCopy("supportingLine", event.target.value)} /></label>
            <label className="field wide"><span>CTA</span><input value={spec.copy.cta ?? ""} onChange={(event) => updateCopy("cta", event.target.value)} /></label>
          </div>
        </details>

        {error ? <p className="ensemblis-notice" data-tone="danger" role="alert">{error}</p> : null}
        <button className="button primary" type="button" onClick={review} disabled={pending || previewing}>
          {pending ? "Preparing review…" : "Review this design"}
        </button>
        <small className="release-visual-helper">
          Preview and export use the same deterministic renderer. No generative credits are used.
        </small>
      </div>
    </div>
  );
}
