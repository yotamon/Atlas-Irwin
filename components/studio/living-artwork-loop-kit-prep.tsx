"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { prepareLivingArtworkLoopKit } from "@/app/studio/living-artwork-actions";
import {
  LIVING_ARTWORK_MOTION_PRESETS,
  type LivingArtworkMotionPresetId,
} from "@/lib/marketing/living-artwork";

const WIDTH = 1080;
const HEIGHT = 1920;

async function loadSourceBitmap(sourceUrl: string) {
  const response = await fetch(sourceUrl, { cache: "no-store", mode: "cors" });
  if (!response.ok) throw new Error(`Could not load the source artwork (${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The selected source is not an image.");
  return createImageBitmap(blob);
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function drawContain(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  boxWidth: number,
  boxHeight: number,
) {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    (WIDTH - drawWidth) / 2,
    (HEIGHT - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

async function buildPortraitSourceFrame(sourceUrl: string) {
  const bitmap = await loadSourceBitmap(sourceUrl);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the portrait source frame.");

    context.save();
    context.filter = "blur(72px) saturate(0.9) brightness(0.62)";
    context.translate(-56, -56);
    drawCover(context, bitmap, WIDTH + 112, HEIGHT + 112);
    context.restore();

    context.fillStyle = "rgba(0,0,0,0.18)";
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.save();
    context.shadowColor = "rgba(0,0,0,0.32)";
    context.shadowBlur = 44;
    context.shadowOffsetY = 18;
    drawContain(context, bitmap, 900, 1320);
    context.restore();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("The portrait source frame could not be encoded."));
      }, "image/png");
    });
    return new File([blob], "living-artwork-source.png", { type: "image/png" });
  } finally {
    bitmap.close();
  }
}

export function LivingArtworkLoopKitPrep({
  artistId,
  contentItemId,
  sourceUrl,
}: {
  artistId: string;
  contentItemId: string;
  sourceUrl: string;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<LivingArtworkMotionPresetId>("subtle_pulse");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function prepare() {
    setError(null);
    startTransition(async () => {
      try {
        const sourceFrame = await buildPortraitSourceFrame(sourceUrl);
        const form = new FormData();
        form.set("artist_id", artistId);
        form.set("content_item_id", contentItemId);
        form.set("motion_preset", preset);
        form.set("source_frame", sourceFrame);
        await prepareLivingArtworkLoopKit(form);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The Loop Kit could not be prepared.");
      }
    });
  }

  return (
    <div className="living-artwork-motion-form">
      <div className="living-artwork-preset-list">
        {LIVING_ARTWORK_MOTION_PRESETS.map((item) => (
          <label key={item.id} className="living-artwork-preset">
            <input
              type="radio"
              name="living_artwork_motion_preset"
              value={item.id}
              checked={preset === item.id}
              onChange={() => setPreset(item.id)}
              disabled={pending}
            />
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </label>
        ))}
      </div>
      <button className="button primary" type="button" onClick={prepare} disabled={pending}>
        {pending ? "Preparing portrait frame…" : "Prepare free Loop Kit"}
      </button>
      <small className="living-artwork-helper">
        Ensemblis prepares a portrait frame locally in your browser: the original artwork stays intact over a softly extended background.
      </small>
      {error ? <p className="ensemblis-notice" data-tone="danger" role="alert">{error}</p> : null}
    </div>
  );
}
