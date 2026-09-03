"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiCheck, FiMusic, FiUploadCloud, FiX } from "react-icons/fi";
import {
  createMediaUploadTarget,
  discardMediaUpload,
  registerMediaUpload,
} from "@/app/studio/catalog-actions";
import { registerTrackStem } from "@/app/studio/stem-actions-safe";
import {
  STEM_CATEGORIES,
  STEM_CATEGORY_LABELS,
  cleanStemLabel,
  inferStemCategory,
} from "@/lib/music-intelligence/stems";
import { createClient } from "@/lib/supabase/client";
import type { StemCategory, StemProvider } from "@/types/stem-database";

type ImportState = "ready" | "uploading" | "queued" | "done" | "error";
type ImportItem = {
  id: string;
  file: File;
  category: StemCategory;
  label: string;
  state: ImportState;
  message?: string;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const PROVIDERS: Array<{ value: StemProvider; label: string }> = [
  { value: "suno", label: "Suno" },
  { value: "manual", label: "Manual / files" },
  { value: "cubase", label: "Cubase" },
  { value: "ableton", label: "Ableton Live" },
  { value: "logic", label: "Logic Pro" },
  { value: "other", label: "Other" },
];

function normalizedAudioMime(file: File) {
  if (file.type.startsWith("audio/")) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({
    wav: "audio/wav",
    wave: "audio/wav",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
  } as Record<string, string>)[extension || ""] || "";
}

function humanSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function durationMs(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Could not read audio metadata."));
    });
    return Number.isFinite(audio.duration) ? Math.max(1, Math.round(audio.duration * 1000)) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function StemUploader({ trackId }: { trackId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<StemProvider>("suno");
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState(false);

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).filter((file) => file.size > 0);
    if (!next.length) return;
    setItems((current) => {
      const signatures = new Set(current.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
      return [
        ...current,
        ...next
          .filter((file) => !signatures.has(`${file.name}:${file.size}:${file.lastModified}`))
          .map((file) => ({
            id: crypto.randomUUID(),
            file,
            category: inferStemCategory(file.name),
            label: cleanStemLabel(file.name),
            state: "ready" as const,
          })),
      ];
    });
  }

  function patch(id: string, values: Partial<ImportItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  }

  async function importAll() {
    if (busy || !items.length) return;
    setBusy(true);
    const supabase = createClient();
    for (const item of items) {
      if (item.state === "done") continue;
      const mimeType = normalizedAudioMime(item.file);
      if (!mimeType) {
        patch(item.id, { state: "error", message: "Unsupported audio format. Use WAV, MP3, FLAC, AIFF, M4A, OGG or Opus." });
        continue;
      }
      if (item.file.size > MAX_FILE_SIZE) {
        patch(item.id, { state: "error", message: `File exceeds the ${humanSize(MAX_FILE_SIZE)} upload limit.` });
        continue;
      }

      patch(item.id, { state: "uploading", message: "Uploading stem…" });
      let target: Awaited<ReturnType<typeof createMediaUploadTarget>> | null = null;
      let registered = false;
      try {
        const [contentHash, duration] = await Promise.all([
          sha256(item.file),
          durationMs(item.file).catch(() => null),
        ]);
        const targetForm = new FormData();
        targetForm.set("asset_type", "stem");
        targetForm.set("mime_type", mimeType);
        targetForm.set("file_size", String(item.file.size));
        targetForm.set("original_name", item.file.name);
        target = await createMediaUploadTarget(targetForm);
        const upload = await supabase.storage.from(target.bucketName).uploadToSignedUrl(
          target.storagePath,
          target.token,
          item.file,
          { cacheControl: "31536000", contentType: mimeType },
        );
        if (upload.error) throw upload.error;

        const registerForm = new FormData();
        const metadata: Record<string, string> = {
          storage_path: target.storagePath,
          bucket_name: target.bucketName,
          visibility: "public",
          asset_type: "stem",
          mime_type: mimeType,
          file_size: String(item.file.size),
          content_hash: contentHash,
          original_name: item.file.name,
          title: item.label,
          description: `Stem imported for Ensemblis Stem Intelligence from ${provider}.`,
          tags: `stem,stem-intelligence,${provider},${item.category}`,
          release_id: "",
          is_primary: "",
          width: "",
          height: "",
          duration_ms: duration ? String(duration) : "",
        };
        Object.entries(metadata).forEach(([key, val]) => registerForm.set(key, val));
        const asset = await registerMediaUpload(registerForm);
        registered = true;

        patch(item.id, { state: "queued", message: "Uploaded. Queuing musical analysis…" });
        const stemForm = new FormData();
        stemForm.set("track_id", trackId);
        stemForm.set("media_asset_id", asset.id);
        stemForm.set("source_provider", provider);
        stemForm.set("category", item.category);
        stemForm.set("label", item.label);
        stemForm.set("source_filename", item.file.name);
        const result = await registerTrackStem(stemForm);
        patch(item.id, {
          state: "done",
          message: result.analysisQueued
            ? "Imported. Ensemblis is analyzing this layer."
            : "Imported. Analysis worker is unavailable in this environment.",
        });
      } catch (error) {
        if (target && !registered) {
          const discard = new FormData();
          discard.set("bucket_name", target.bucketName);
          discard.set("storage_path", target.storagePath);
          await discardMediaUpload(discard).catch(() => undefined);
        }
        patch(item.id, {
          state: "error",
          message: error instanceof Error ? error.message : "Stem import failed.",
        });
      }
    }
    setBusy(false);
    router.refresh();
  }

  const done = items.filter((item) => item.state === "done").length;
  const pending = items.some((item) => item.state !== "done");

  return (
    <div className="stem-importer">
      <div className="stem-import-toolbar">
        <label className="field compact-field">
          <span>Source</span>
          <select value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value as StemProvider)}>
            {PROVIDERS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <p>Ensemblis recognizes common stem names automatically. You can correct any role before import.</p>
      </div>

      <div
        className={`media-dropzone stem-dropzone${dragging ? " dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
      >
        <FiUploadCloud aria-hidden />
        <strong>Drop all stems together</strong>
        <span>WAV is ideal. MP3, FLAC, AIFF, M4A, OGG and Opus also work. Ensemblis analyzes each layer against the exact current master.</span>
        <button type="button" className="button" onClick={() => inputRef.current?.click()}>Choose stems</button>
        <input
          ref={inputRef}
          hidden
          multiple
          type="file"
          accept="audio/*,.wav,.wave,.mp3,.flac,.aif,.aiff,.m4a,.ogg,.opus"
          onChange={(event) => event.target.files && addFiles(event.target.files)}
        />
      </div>

      {items.length ? (
        <div className="stem-import-list" aria-live="polite">
          {items.map((item) => (
            <div className={`stem-import-row ${item.state}`} key={item.id}>
              <span className="stem-file-icon">{item.state === "done" ? <FiCheck /> : <FiMusic />}</span>
              <div className="stem-import-file">
                <input
                  aria-label={`Label for ${item.file.name}`}
                  value={item.label}
                  disabled={busy || item.state === "done"}
                  onChange={(event) => patch(item.id, { label: event.target.value })}
                />
                <small>{item.file.name} · {humanSize(item.file.size)}{item.message ? ` · ${item.message}` : ""}</small>
              </div>
              <select
                aria-label={`Role for ${item.file.name}`}
                value={item.category}
                disabled={busy || item.state === "done"}
                onChange={(event) => patch(item.id, { category: event.target.value as StemCategory })}
              >
                {STEM_CATEGORIES.map((category) => <option value={category} key={category}>{STEM_CATEGORY_LABELS[category]}</option>)}
              </select>
              {!busy && item.state !== "done" ? (
                <button type="button" className="icon-button" aria-label={`Remove ${item.file.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>
                  <FiX />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="media-upload-actions stem-import-actions">
        <button className="button primary" type="button" onClick={importAll} disabled={!items.length || busy || !pending}>
          {busy ? `Importing ${Math.min(done + 1, items.length)} of ${items.length}…` : done === items.length && items.length ? "Import complete" : `Import & analyze ${items.length || ""} stem${items.length === 1 ? "" : "s"}`}
        </button>
        <span>{done ? `${done}/${items.length} imported` : "No AI generation cost. Analysis runs in the Ensemblis Media Worker."}</span>
      </div>
    </div>
  );
}
