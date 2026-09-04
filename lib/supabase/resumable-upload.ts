const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const TUS_VERSION = "1.0.0";
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000] as const;
const RESUME_PREFIX = "ensemblis:tus:";

export type ResumableUploadTarget = {
  bucketName: string;
  storagePath: string;
  token: string;
};

export class ResumableUploadAuthorizationError extends Error {
  constructor(message = "The resumable upload authorization expired.") {
    super(message);
    this.name = "ResumableUploadAuthorizationError";
  }
}

function resumableEndpoint() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) throw new Error("Supabase URL is not configured for resumable uploads.");
  const url = new URL(configured);
  const projectRef = url.hostname.endsWith(".supabase.co") ? url.hostname.split(".")[0] : null;
  return projectRef
    ? `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
    : `${url.origin}/storage/v1/upload/resumable`;
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadMetadata(file: File, target: ResumableUploadTarget) {
  return [
    ["bucketName", target.bucketName],
    ["objectName", target.storagePath],
    ["contentType", file.type || "application/octet-stream"],
    ["cacheControl", "31536000"],
  ].map(([key, value]) => `${key} ${encodeBase64(value)}`).join(",");
}

function resumeKey(file: File, target: ResumableUploadTarget) {
  return `${RESUME_PREFIX}${target.bucketName}:${target.storagePath}:${file.size}:${file.lastModified}`;
}

function readResumeUrl(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberResumeUrl(key: string, url: string) {
  try {
    sessionStorage.setItem(key, url);
  } catch {
    // Resuming is an enhancement. Uploading still works when storage is unavailable.
  }
}

function forgetResumeUrl(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing else to clean up.
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function signedHeaders(target: ResumableUploadTarget) {
  return {
    "Tus-Resumable": TUS_VERSION,
    "x-signature": target.token,
  };
}

async function responseError(response: Response, fallback: string) {
  if (response.status === 401 || response.status === 403) {
    throw new ResumableUploadAuthorizationError();
  }
  const body = await response.text().catch(() => "");
  const detail = body.trim().slice(0, 240);
  throw new Error(detail ? `${fallback} (${response.status}): ${detail}` : `${fallback} (${response.status}).`);
}

async function createUpload(file: File, target: ResumableUploadTarget) {
  const endpoint = resumableEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...signedHeaders(target),
      "Upload-Length": String(file.size),
      "Upload-Metadata": uploadMetadata(file, target),
    },
  });
  if (!response.ok) await responseError(response, "Could not start resumable upload");
  const location = response.headers.get("Location");
  if (!location) throw new Error("Supabase did not return a resumable upload URL.");
  return new URL(location, endpoint).toString();
}

async function currentOffset(uploadUrl: string, target: ResumableUploadTarget) {
  const response = await fetch(uploadUrl, {
    method: "HEAD",
    headers: signedHeaders(target),
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) await responseError(response, "Could not resume upload");
  const offset = Number(response.headers.get("Upload-Offset"));
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

async function patchChunk(
  uploadUrl: string,
  target: ResumableUploadTarget,
  chunk: Blob,
  offset: number,
) {
  const response = await fetch(uploadUrl, {
    method: "PATCH",
    headers: {
      ...signedHeaders(target),
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": String(offset),
    },
    body: chunk,
  });
  if (!response.ok) await responseError(response, "Resumable upload chunk failed");
  const nextOffset = Number(response.headers.get("Upload-Offset"));
  return Number.isFinite(nextOffset) && nextOffset >= 0 ? nextOffset : offset + chunk.size;
}

export async function uploadResumableMedia({
  file,
  target,
  onProgress,
}: {
  file: File;
  target: ResumableUploadTarget;
  onProgress?: (progress: number) => void;
}) {
  const key = resumeKey(file, target);
  const resumedUrl = readResumeUrl(key);
  const resumedOffset: number | null = resumedUrl
    ? await currentOffset(resumedUrl, target).catch((error) => {
        if (error instanceof ResumableUploadAuthorizationError) throw error;
        return null;
      })
    : null;

  let uploadUrl: string;
  let offset: number;

  if (resumedUrl && resumedOffset !== null) {
    uploadUrl = resumedUrl;
    offset = resumedOffset;
  } else {
    forgetResumeUrl(key);
    uploadUrl = await createUpload(file, target);
    rememberResumeUrl(key, uploadUrl);
    offset = 0;
  }

  onProgress?.(file.size ? Math.min(1, offset / file.size) : 0);

  while (offset < file.size) {
    const chunkOffset: number = offset;
    const chunk = file.slice(chunkOffset, Math.min(file.size, chunkOffset + TUS_CHUNK_SIZE));
    let chunkHandled = false;
    let lastError: unknown = null;

    for (const delay of RETRY_DELAYS) {
      if (delay) await sleep(delay);
      try {
        offset = await patchChunk(uploadUrl, target, chunk, chunkOffset);
        onProgress?.(file.size ? Math.min(1, offset / file.size) : 1);
        chunkHandled = true;
        break;
      } catch (error) {
        if (error instanceof ResumableUploadAuthorizationError) throw error;
        lastError = error;
        const serverOffset = await currentOffset(uploadUrl, target).catch(() => null);
        if (serverOffset === null) {
          forgetResumeUrl(key);
          uploadUrl = await createUpload(file, target);
          rememberResumeUrl(key, uploadUrl);
          offset = 0;
          onProgress?.(0);
          chunkHandled = true;
          break;
        }
        if (serverOffset !== chunkOffset) {
          offset = serverOffset;
          onProgress?.(file.size ? Math.min(1, offset / file.size) : 1);
          chunkHandled = true;
          break;
        }
        offset = chunkOffset;
      }
    }

    if (!chunkHandled && offset < file.size) {
      throw lastError instanceof Error ? lastError : new Error("Upload interrupted after automatic retries.");
    }
  }

  forgetResumeUrl(key);
  onProgress?.(1);
}
