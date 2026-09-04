import { Upload } from "tus-js-client";

const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export type ResumableUploadTarget = {
  bucketName: string;
  storagePath: string;
};

function resumableEndpoint() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) throw new Error("Supabase URL is not configured for resumable uploads.");
  const url = new URL(configured);
  const projectRef = url.hostname.endsWith(".supabase.co") ? url.hostname.split(".")[0] : null;
  return projectRef
    ? `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
    : `${url.origin}/storage/v1/upload/resumable`;
}

export async function uploadResumableMedia({
  file,
  target,
  accessToken,
  onProgress,
}: {
  file: File;
  target: ResumableUploadTarget;
  accessToken: string;
  onProgress?: (progress: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: resumableEndpoint(),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      chunkSize: TUS_CHUNK_SIZE,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: () => Promise.resolve(`ensemblis:${target.bucketName}:${target.storagePath}:${file.size}`),
      metadata: {
        bucketName: target.bucketName,
        objectName: target.storagePath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "31536000",
      },
      onProgress(bytesUploaded, bytesTotal) {
        onProgress?.(bytesTotal ? Math.min(1, bytesUploaded / bytesTotal) : 0);
      },
      onError(error) {
        reject(error);
      },
      onSuccess() {
        onProgress?.(1);
        resolve();
      },
    });

    void upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch(reject);
  });
}
