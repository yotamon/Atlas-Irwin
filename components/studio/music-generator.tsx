"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiDownload, FiMusic, FiSave, FiZap } from "react-icons/fi";
import {
  createMediaUploadTarget,
  discardMediaUpload,
  registerMediaUpload,
} from "@/app/studio/catalog-actions";
import {
  MUSIC_VIBES,
  buildMusicPrompt,
  estimateMusicCost,
  safeTrackFilename,
  type MusicGenerationInput,
  type MusicProviderId,
  type MusicVibeId,
} from "@/lib/music/generator";
import { createClient } from "@/lib/supabase/client";
import styles from "./music-generator.module.css";

type ProviderOption = {
  id: MusicProviderId;
  name: string;
  model: string;
  enabled: boolean;
  price: string;
  note: string;
};

type Generation = {
  id: string;
  index: number;
  title: string;
  provider: MusicProviderId;
  model: string;
  cost: number;
  prompt: string;
  vibe: MusicVibeId;
  blob: Blob;
  url: string;
  saved: boolean;
  saving: boolean;
  saveError?: string;
};

type MusicGeneratorProps = {
  providers: ProviderOption[];
  brandContext: string;
  artistId: string;
  artistName: string;
};

function bytesLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function audioDurationMs(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Could not read generated audio metadata."));
    });
    return Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function responseMessage(value: unknown) {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  return "Music generation failed.";
}

export function MusicGenerator({
  providers,
  brandContext,
  artistId,
  artistName,
}: MusicGeneratorProps) {
  const router = useRouter();
  const firstEnabled = providers.find((provider) => provider.enabled)?.id ?? "minimax";
  const hasArtistDna = Boolean(brandContext.trim());
  const [provider, setProvider] = useState<MusicProviderId>(firstEnabled);
  const [title, setTitle] = useState("Untitled Draft");
  const [idea, setIdea] = useState("A focused new track built around one immediately memorable musical signature.");
  const [vibe, setVibe] = useState<MusicVibeId>("focused");
  const [bpm, setBpm] = useState(118);
  const [durationSeconds, setDurationSeconds] = useState(240);
  const [signatureIdea, setSignatureIdea] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [lyrics, setLyrics] = useState("");
  const [preserveArtistDna, setPreserveArtistDna] = useState(hasArtistDna);
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const urls = useRef<string[]>([]);

  const selectedProvider = providers.find((entry) => entry.id === provider);
  const input = useMemo<MusicGenerationInput>(() => ({
    provider,
    title,
    idea,
    vibe,
    bpm,
    durationSeconds,
    instrumental,
    lyrics,
    signatureIdea,
    brandContext,
    preserveArtistDna: hasArtistDna && preserveArtistDna,
  }), [provider, title, idea, vibe, bpm, durationSeconds, instrumental, lyrics, signatureIdea, brandContext, hasArtistDna, preserveArtistDna]);
  const prompt = useMemo(() => buildMusicPrompt(input), [input]);
  const estimatedCost = estimateMusicCost(provider, durationSeconds, variants, selectedProvider?.model);

  useEffect(() => () => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function generate() {
    if (busy || !selectedProvider?.enabled) return;
    if (!idea.trim()) {
      setError("Give the track a creative direction first.");
      return;
    }
    if (!instrumental && !lyrics.trim()) {
      setError("Add lyrics or switch back to instrumental mode.");
      return;
    }

    setBusy(true);
    setError("");
    const requestInput = { ...input, title: title.trim() || "Untitled Draft" };
    const jobs = Array.from({ length: variants }, async (_, variantIndex) => {
      const response = await fetch("/api/studio/music/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestInput),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(responseMessage(body));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      return {
        id: crypto.randomUUID(),
        index: variantIndex + 1,
        title: requestInput.title,
        provider,
        model: response.headers.get("X-Ensemblis-Music-Model") || selectedProvider.model,
        cost: Number(response.headers.get("X-Ensemblis-Music-Estimated-Cost") || 0),
        prompt,
        vibe,
        blob,
        url,
        saved: false,
        saving: false,
      } satisfies Generation;
    });

    const results = await Promise.allSettled(jobs);
    const completed = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (completed.length) setGenerations((current) => [...completed, ...current]);
    if (failed.length) setError(failed.map((failure) => failure instanceof Error ? failure.message : "Generation failed.").join(" "));
    setBusy(false);
  }

  async function saveToLibrary(generation: Generation) {
    if (generation.saved || generation.saving) return;
    setGenerations((current) => current.map((item) => item.id === generation.id ? { ...item, saving: true, saveError: undefined } : item));
    let target: Awaited<ReturnType<typeof createMediaUploadTarget>> | null = null;
    try {
      const filename = safeTrackFilename(generation.title, generation.provider, generation.index);
      const file = new File([generation.blob], filename, { type: generation.blob.type || "audio/mpeg" });
      const [contentHash, durationMs] = await Promise.all([sha256(file), audioDurationMs(file)]);
      const targetForm = new FormData();
      targetForm.set("asset_type", "master_audio");
      targetForm.set("mime_type", file.type);
      targetForm.set("file_size", String(file.size));
      targetForm.set("original_name", file.name);
      target = await createMediaUploadTarget(targetForm);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage.from(target.bucketName).uploadToSignedUrl(
        target.storagePath,
        target.token,
        file,
        { cacheControl: "31536000", contentType: file.type },
      );
      if (uploadError) throw uploadError;

      const registration = new FormData();
      const description = [
        `Generated in Ensemblis Music Lab for ${artistName} with ${generation.provider} / ${generation.model}.`,
        `Estimated generation cost: $${generation.cost.toFixed(2)}.`,
        `Prompt: ${generation.prompt.slice(0, 1500)}`,
      ].join("\n\n");
      Object.entries({
        storage_path: target.storagePath,
        bucket_name: target.bucketName,
        visibility: "public",
        asset_type: "master_audio",
        mime_type: file.type,
        file_size: String(file.size),
        content_hash: contentHash,
        original_name: file.name,
        title: `${generation.title} - AI draft`,
        description,
        tags: `ai-generated, ensemblis-music-lab, artist:${artistId}, ${generation.provider}, ${generation.model}, ${generation.vibe}`,
        duration_ms: String(durationMs || ""),
        width: "",
        height: "",
        release_id: "",
        is_primary: "",
      }).forEach(([key, value]) => registration.set(key, value));
      await registerMediaUpload(registration);
      setGenerations((current) => current.map((item) => item.id === generation.id ? { ...item, saving: false, saved: true } : item));
      router.refresh();
    } catch (saveError) {
      if (target) {
        const discard = new FormData();
        discard.set("bucket_name", target.bucketName);
        discard.set("storage_path", target.storagePath);
        await discardMediaUpload(discard).catch(() => undefined);
      }
      setGenerations((current) => current.map((item) => item.id === generation.id ? {
        ...item,
        saving: false,
        saveError: saveError instanceof Error ? saveError.message : "Could not save this draft.",
      } : item));
    }
  }

  return (
    <div className={styles.lab}>
      <section className={styles.controls}>
        <div className={styles.sectionIntro}>
          <span className="section-label">01 / Engine</span>
          <h2>Choose the spend</h2>
          <p>MiniMax is the cheap ideation engine. Eleven is the control engine. Both use the same artist-aware Ensemblis prompt architecture.</p>
        </div>

        <div className={styles.providers}>
          {providers.map((option) => (
            <button
              type="button"
              key={option.id}
              disabled={!option.enabled || busy}
              className={`${styles.provider}${provider === option.id ? ` ${styles.activeProvider}` : ""}`}
              onClick={() => setProvider(option.id)}
            >
              <span className={styles.providerTop}><strong>{option.name}</strong><em>{option.price}</em></span>
              <span>{option.model}</span>
              <small>{option.enabled ? option.note : "Add the API key in the server environment to enable this provider."}</small>
            </button>
          ))}
        </div>

        <div className={styles.formSection}>
          <div className="form-grid">
            <label className="field">
              <span>Working title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
            </label>
            <label className="field">
              <span>Energy & feel</span>
              <select value={vibe} onChange={(event) => setVibe(event.target.value as MusicVibeId)}>
                {MUSIC_VIBES.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <label className="field wide">
              <span>Creative direction</span>
              <textarea rows={4} value={idea} onChange={(event) => setIdea(event.target.value)} maxLength={900} />
            </label>
            <label className="field wide">
              <span>One signature idea</span>
              <input value={signatureIdea} onChange={(event) => setSignatureIdea(event.target.value)} maxLength={400} placeholder="Example: one rhythmic, melodic or textural idea that can evolve across the track" />
            </label>
            <label className="field">
              <span>BPM</span>
              <input type="number" min={80} max={150} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
            </label>
            <label className="field">
              <span>{provider === "eleven" ? "Duration" : "Target duration hint"}</span>
              <select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                <option value={180}>3:00</option>
                <option value={210}>3:30</option>
                <option value={240}>4:00</option>
                <option value={270}>4:30</option>
                <option value={300}>5:00</option>
              </select>
            </label>
          </div>

          <div className={styles.switches}>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={hasArtistDna && preserveArtistDna}
                disabled={!hasArtistDna}
                onChange={(event) => setPreserveArtistDna(event.target.checked)}
              />
              Preserve {artistName} DNA
            </label>
            <label className="checkbox-field"><input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} /> Instrumental</label>
            <label className="field">
              <span>Variants</span>
              <select value={variants} onChange={(event) => setVariants(Number(event.target.value))}>
                <option value={1}>1 draft</option>
                <option value={2}>2 drafts</option>
              </select>
            </label>
          </div>

          {!hasArtistDna ? <small>Add Brand essence or Music world guidance in this artist&apos;s Brand profile to enable DNA preservation.</small> : null}

          {!instrumental ? (
            <label className="field">
              <span>Lyrics</span>
              <textarea rows={10} value={lyrics} onChange={(event) => setLyrics(event.target.value)} maxLength={3500} placeholder="Use section tags such as [Intro], [Verse], [Chorus], [Bridge], [Outro]" />
            </label>
          ) : null}
        </div>

        <details className={styles.promptPreview}>
          <summary>Inspect generated prompt</summary>
          <p>{prompt}</p>
        </details>

        <div className={styles.generateBar}>
          <div>
            <span>Estimated spend</span>
            <strong>${estimatedCost.toFixed(2)}</strong>
            <small>{variants} generation{variants === 1 ? "" : "s"} via {selectedProvider?.name ?? provider}</small>
          </div>
          <button className="button primary" type="button" disabled={busy || !selectedProvider?.enabled} onClick={generate}>
            <FiZap aria-hidden />
            {busy ? `Generating ${variants === 2 ? "2 drafts" : "draft"}...` : `Generate ${variants === 2 ? "pair" : "draft"}`}
          </button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      <aside className={styles.results}>
        <div className={styles.sectionIntro}>
          <span className="section-label">02 / Candidates</span>
          <h2>Keep only what works</h2>
          <p>Listen, download, then deliberately save the good drafts for {artistName}. Unfinished ideas stay local unless you choose to add them to the reusable library.</p>
        </div>

        {busy && !generations.length ? (
          <div className={styles.generatingState}>
            <FiMusic aria-hidden />
            <strong>Building the track</strong>
            <span>The provider is composing the full audio now.</span>
          </div>
        ) : null}

        {generations.length ? (
          <div className={styles.generationList}>
            {generations.map((generation) => (
              <article className={styles.generation} key={generation.id}>
                <div className={styles.generationHead}>
                  <div><span>{generation.provider} / {generation.model}</span><h3>{generation.title}</h3></div>
                  <strong>${generation.cost.toFixed(2)}</strong>
                </div>
                <audio controls preload="metadata" src={generation.url} />
                <div className={styles.generationMeta}><span>{bytesLabel(generation.blob.size)}</span><span>Variant {generation.index}</span></div>
                <div className={styles.resultActions}>
                  <a className="button" href={generation.url} download={safeTrackFilename(generation.title, generation.provider, generation.index)}><FiDownload /> Download</a>
                  <button className="button" type="button" disabled={generation.saving || generation.saved} onClick={() => saveToLibrary(generation)}><FiSave /> {generation.saved ? "Saved" : generation.saving ? "Saving..." : "Save to public library"}</button>
                </div>
                {generation.saveError ? <p className={styles.error}>{generation.saveError}</p> : null}
              </article>
            ))}
          </div>
        ) : !busy ? (
          <div className={styles.emptyResult}>
            <FiMusic aria-hidden />
            <strong>No drafts yet</strong>
            <span>Start with one cheap generation, then spend on a second provider only if the idea deserves it.</span>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
