"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiCheck, FiFile, FiUploadCloud, FiX } from "react-icons/fi";
import {
  createMediaUploadTarget,
  discardMediaUpload,
  registerMediaUpload,
} from "@/app/studio/catalog-actions";
import { attachContentMediaV2 } from "@/app/studio/content-actions-v2";
import { attachReleaseMasterFromMedia, createVaultTrackFromMedia } from "@/app/studio/growth-media-actions";
import { createClient } from "@/lib/supabase/client";
import {
  compatibleMediaTypes,
  defaultMediaType,
  isCompatibleMediaType,
  MEDIA_TYPE_LABELS,
  type MediaType,
} from "@/lib/studio/media";

type UploadItem = {
  file: File;
  role: MediaType;
  state: "ready" | "uploading" | "done" | "error";
  message?: string;
};

const PUBLIC_LIMIT = 100 * 1024 * 1024;
const HASH_LIMIT = 128 * 1024 * 1024;

function humanSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function cleanAudioTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

async function sha256(file: File) {
  if (file.size > HASH_LIMIT) return "";
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mediaDimensions(file: File) {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
    return { width: "", height: "", duration_ms: "" };
  }
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: String(image.naturalWidth), height: String(image.naturalHeight), duration_ms: "" };
    }
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    media.preload = "metadata";
    media.src = url;
    await new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve();
      media.onerror = () => reject(new Error("Could not read media metadata."));
    });
    const video = media instanceof HTMLVideoElement ? media : null;
    return {
      width: video ? String(video.videoWidth) : "",
      height: video ? String(video.videoHeight) : "",
      duration_ms: Number.isFinite(media.duration) ? String(Math.round(media.duration * 1000)) : "",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MediaUploader({
  releaseId,
  contentItemId,
  defaultRole = "cover",
  vaultMode = false,
  releaseMasterMode = false,
}: {
  releaseId?: string;
  contentItemId?: string;
  defaultRole?: MediaType;
  vaultMode?: boolean;
  releaseMasterMode?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [primary, setPrimary] = useState(Boolean(releaseId && !contentItemId && !vaultMode));
  const [busy, setBusy] = useState(false);

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).filter((file) => file.size > 0 && (!(vaultMode || releaseMasterMode) || file.type.startsWith("audio/")));
    if (!next.length) return;
    if (releaseMasterMode) {
      const file = next[0];
      setItems([{ file, role: "master_audio", state: "ready" }]);
      return;
    }
    setItems((current) => {
      const signatures = new Set(current.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
      return [...current, ...next.filter((file) => !signatures.has(`${file.name}:${file.size}:${file.lastModified}`)).map((file) => ({
        file,
        role: (isCompatibleMediaType(defaultRole, file.type) ? defaultRole : defaultMediaType(file.type) ?? defaultRole),
        state: "ready" as const,
      }))];
    });
  }

  async function upload() {
    if (!items.length || busy) return;
    if (releaseMasterMode && !releaseId) {
      setItems((current) => current.map((item) => ({ ...item, state: "error", message: "A release is required for a release master." })));
      return;
    }
    if (items.some((item) => !isCompatibleMediaType(item.role, item.file.type))) {
      setItems((current) => current.map((item) => !isCompatibleMediaType(item.role, item.file.type) ? { ...item, state: "error", message: "Choose a compatible use for this format." } : item));
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const limit = PUBLIC_LIMIT;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.state === "done") continue;
      if (item.file.size > limit) {
        setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, state: "error", message: `This file exceeds the ${humanSize(limit)} upload limit.` } : entry));
        continue;
      }
      setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, state: "uploading", message: releaseMasterMode ? "Uploading master and preparing Music Intelligence…" : vaultMode ? "Uploading master…" : "Uploading securely…" } : entry));
      let uploadTarget: Awaited<ReturnType<typeof createMediaUploadTarget>> | null = null;
      let registered = false;
      let releaseMasterResult: Awaited<ReturnType<typeof attachReleaseMasterFromMedia>> | null = null;
      try {
        const [contentHash, dimensions] = await Promise.all([sha256(item.file), mediaDimensions(item.file).catch(() => ({ width: "", height: "", duration_ms: "" }))]);
        const targetForm = new FormData();
        targetForm.set("asset_type", item.role);
        targetForm.set("mime_type", item.file.type);
        targetForm.set("file_size", String(item.file.size));
        targetForm.set("original_name", item.file.name);
        uploadTarget = await createMediaUploadTarget(targetForm);
        const { error } = await supabase.storage.from(uploadTarget.bucketName).uploadToSignedUrl(uploadTarget.storagePath, uploadTarget.token, item.file, {
          cacheControl: "31536000",
          contentType: item.file.type,
        });
        if (error) throw error;
        const form = new FormData();
        Object.entries({
          storage_path: uploadTarget.storagePath,
          bucket_name: uploadTarget.bucketName,
          visibility: "public",
          asset_type: item.role,
          mime_type: item.file.type,
          file_size: String(item.file.size),
          content_hash: contentHash,
          original_name: item.file.name,
          title: items.length === 1 ? title : "",
          description,
          tags: releaseMasterMode ? [tags, "release-master"].filter(Boolean).join(",") : vaultMode ? [tags, "unreleased", "vault"].filter(Boolean).join(",") : tags,
          release_id: contentItemId || vaultMode ? "" : releaseId ?? "",
          is_primary: primary ? "on" : "",
          ...dimensions,
        }).forEach(([key, value]) => form.set(key, value));
        const result = await registerMediaUpload(form);
        registered = true;
        if (contentItemId) {
          const attachForm = new FormData();
          attachForm.set("content_item_id", contentItemId);
          attachForm.set("media_asset_id", result.id);
          attachForm.set("role", item.role);
          await attachContentMediaV2(attachForm);
        }
        if (vaultMode) {
          const vaultForm = new FormData();
          vaultForm.set("media_asset_id", result.id);
          vaultForm.set("title", items.length === 1 && title.trim() ? title.trim() : cleanAudioTitle(item.file.name));
          await createVaultTrackFromMedia(vaultForm);
        }
        if (releaseMasterMode && releaseId) {
          const masterForm = new FormData();
          masterForm.set("media_asset_id", result.id);
          masterForm.set("release_id", releaseId);
          releaseMasterResult = await attachReleaseMasterFromMedia(masterForm);
        }
        setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? {
          ...entry,
          state: "done",
          message: releaseMasterMode
            ? releaseMasterResult?.analysisReused
              ? "Master attached. Existing Music Intelligence was reused instantly."
              : releaseMasterResult?.analysisQueued
                ? "Master attached. Atlas is analyzing its structure and strongest hooks."
                : "Master attached. Analysis can be retried from the release when the media worker is available."
            : vaultMode
              ? "Master is in the Vault. Free audio analysis was queued when the media worker is available."
              : result.deduplicated
                ? "Already in the library, existing file reused and attached."
                : contentItemId
                  ? "Uploaded and attached to this content item."
                  : "Added to the library.",
        } : entry));
      } catch (error) {
        if (uploadTarget && !registered) {
          const discardForm = new FormData();
          discardForm.set("bucket_name", uploadTarget.bucketName);
          discardForm.set("storage_path", uploadTarget.storagePath);
          await discardMediaUpload(discardForm).catch(() => undefined);
        }
        setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? {
          ...entry,
          state: "error",
          message: error instanceof Error ? error.message : "Upload failed. Try again.",
        } : entry));
      }
    }
    setBusy(false);
    router.refresh();
  }

  const completed = items.filter((item) => item.state === "done").length;
  const hasPending = items.some((item) => item.state === "ready" || item.state === "error");
  const contextualAttach = Boolean(releaseId || contentItemId || vaultMode || releaseMasterMode);

  return (
    <div className={`media-uploader${vaultMode ? " vault-media-uploader" : ""}${releaseMasterMode ? " release-master-uploader" : ""}`}>
      <div
        className={`media-dropzone${dragging ? " dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
      >
        <FiUploadCloud aria-hidden />
        <strong>{releaseMasterMode ? "Drop the release master here" : vaultMode ? "Drop unreleased masters here" : "Drop media here"}</strong>
        <span>{releaseMasterMode ? "WAV, MP3 or another audio master. Atlas will attach it to this release and analyze its structure and strongest hooks." : vaultMode ? "Audio masters only. Each file becomes an independent Vault track." : "Images, video, audio, masters, stems, or ZIP files"}</span>
        <button type="button" className="button" onClick={() => inputRef.current?.click()}>{releaseMasterMode ? "Choose master" : vaultMode ? "Choose masters" : "Choose files"}</button>
        <input ref={inputRef} hidden multiple={!releaseMasterMode} type="file" accept={vaultMode || releaseMasterMode ? "audio/*" : "image/*,video/*,audio/*,.zip"} onChange={(event) => event.target.files && addFiles(event.target.files)} />
      </div>

      {items.length ? (
        <div className="upload-queue" aria-live="polite">
          {items.map((item, index) => (
            <div className={`upload-item ${item.state}`} key={`${item.file.name}-${item.file.lastModified}`}>
              <span className="upload-file-icon">{item.state === "done" ? <FiCheck /> : <FiFile />}</span>
              <span><strong>{item.file.name}</strong><small>{humanSize(item.file.size)} · {item.file.type || "Unknown format"}{item.message ? ` · ${item.message}` : ""}</small></span>
              <select aria-label={`Use for ${item.file.name}`} value={item.role} disabled={vaultMode || releaseMasterMode || busy || item.state === "done"} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, role: event.target.value as MediaType, state: entry.state === "error" ? "ready" : entry.state, message: undefined } : entry))}>{compatibleMediaTypes(item.file.type).map((type) => <option value={type} key={type}>{MEDIA_TYPE_LABELS[type]}</option>)}</select>
              {!busy && item.state !== "done" ? <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><FiX /></button> : null}
            </div>
          ))}
        </div>
      ) : null}

      {!releaseMasterMode ? <div className="form-grid media-upload-fields">
        <label className="field"><span>Display name {items.length > 1 ? "(file names are used for bulk imports)" : ""}</span><input value={title} onChange={(event) => setTitle(event.target.value)} disabled={items.length > 1} placeholder={items[0] ? cleanAudioTitle(items[0].file.name) : "Shown in the library"} /></label>
        <label className="field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={vaultMode ? "mastered, nu-disco, priority" : "release, artwork, blue-hour"} /></label>
        <label className="field wide"><span>Notes</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder={vaultMode ? "Optional source/rights notes. Track-specific creative notes can be refined in the Vault." : "Creative context, rights, source, or intended use"} /></label>
        {releaseId && !contentItemId && !vaultMode ? <label className="checkbox-field"><input type="checkbox" checked={primary} onChange={(event) => setPrimary(event.target.checked)} /> Make primary for this role</label> : null}
      </div> : null}
      <div className="media-upload-actions">
        <button className="button primary" type="button" disabled={!items.length || busy || !hasPending} onClick={upload}>
          {busy ? `Uploading ${completed + 1} of ${items.length}…` : completed === items.length && items.length ? "Upload complete" : releaseMasterMode ? "Upload & analyze master" : vaultMode ? `Import ${items.length || ""} to Vault` : contextualAttach ? "Upload and attach" : `Add ${items.length || ""} to library`}
        </button>
        {completed ? <span>{completed} of {items.length} ready</span> : <span>{releaseMasterMode ? "The previous master stays in Media Library history when you replace it." : vaultMode ? "Upload is reusable in Media Library; audio analysis does not spend an AI call." : contentItemId ? "Media will be attached to this content item." : "Media is published to the public asset library."}</span>}
      </div>
    </div>
  );
}
