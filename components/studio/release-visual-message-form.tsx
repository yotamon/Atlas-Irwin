"use client";

import { useState } from "react";
import { saveReleaseVisualMessage } from "@/app/studio/release-visual-actions";
import {
  defaultReleaseVisualCopy,
  RELEASE_VISUAL_MESSAGE_INTENTS,
  type ReleaseVisualMessageIntent,
} from "@/lib/marketing/release-visual";

const LABELS: Record<ReleaseVisualMessageIntent, string> = {
  clean: "Clean",
  out_now: "Out Now",
  out_friday: "Out Friday",
  pre_save: "Pre-save",
  listen_now: "Listen Now",
  custom: "Custom",
};

export function ReleaseVisualMessageForm({
  artistId,
  contentItemId,
  releaseTitle,
  artistName,
  releaseDate,
  recommendedIntent,
}: {
  artistId: string;
  contentItemId: string;
  releaseTitle: string;
  artistName: string;
  releaseDate: string | null;
  recommendedIntent: ReleaseVisualMessageIntent;
}) {
  const [intent, setIntent] = useState<ReleaseVisualMessageIntent>(recommendedIntent);
  const [copy, setCopy] = useState(() => defaultReleaseVisualCopy({
    intent: recommendedIntent,
    releaseTitle,
    artistName,
    releaseDate,
  }));

  function choose(next: ReleaseVisualMessageIntent) {
    setIntent(next);
    setCopy(defaultReleaseVisualCopy({
      intent: next,
      releaseTitle,
      artistName,
      releaseDate,
    }));
  }

  function field<K extends keyof typeof copy>(key: K, next: string) {
    setCopy((current) => ({ ...current, [key]: next || null }));
  }

  return (
    <form action={saveReleaseVisualMessage} className="release-visual-message-form">
      <input type="hidden" name="artist_id" value={artistId} />
      <input type="hidden" name="content_item_id" value={contentItemId} />
      <input type="hidden" name="message_intent" value={intent} />
      <input type="hidden" name="package_id" value="instagram-story-image" />

      <div className="release-visual-choice-grid" role="radiogroup" aria-label="Promotion message">
        {RELEASE_VISUAL_MESSAGE_INTENTS.map((item) => (
          <button
            className={intent === item ? "release-visual-choice is-selected" : "release-visual-choice"}
            type="button"
            role="radio"
            aria-checked={intent === item}
            onClick={() => choose(item)}
            key={item}
          >
            <strong>{LABELS[item]}</strong>
            <small>{item === "clean"
              ? "Artwork first, no promotional badge"
              : item === "custom"
                ? "Write the exact message yourself"
                : "Editable deterministic typography"}</small>
          </button>
        ))}
      </div>

      <div className="form-grid release-visual-copy-grid">
        <label className="field">
          <span>Headline</span>
          <input name="headline" value={copy.headline ?? ""} onChange={(event) => field("headline", event.target.value)} placeholder="Optional" />
        </label>
        <label className="field">
          <span>Date label</span>
          <input name="date_label" value={copy.dateLabel ?? ""} onChange={(event) => field("dateLabel", event.target.value)} placeholder="Optional" />
        </label>
        <label className="field">
          <span>Release title</span>
          <input name="title" value={copy.title ?? ""} onChange={(event) => field("title", event.target.value)} />
        </label>
        <label className="field">
          <span>Artist</span>
          <input name="artist_name" value={copy.artistName ?? ""} onChange={(event) => field("artistName", event.target.value)} />
        </label>
        <label className="field wide">
          <span>Supporting line</span>
          <input name="supporting_line" value={copy.supportingLine ?? ""} onChange={(event) => field("supportingLine", event.target.value)} placeholder="Optional" />
        </label>
        <label className="field wide">
          <span>CTA</span>
          <input name="cta" value={copy.cta ?? ""} onChange={(event) => field("cta", event.target.value)} placeholder="Optional" />
        </label>
      </div>

      <button className="button primary" type="submit">Continue to design</button>
      <small className="release-visual-helper">
        This text is rendered exactly by Ensemblis. No image model is asked to spell promotional copy.
      </small>
    </form>
  );
}
