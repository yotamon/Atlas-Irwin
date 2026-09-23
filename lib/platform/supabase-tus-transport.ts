"use client";

import { uploadResumableMedia, type ResumableUploadTarget } from "@/lib/supabase/resumable-upload";
import type { MediaTransport } from "./media-transport";

export const supabaseTusMediaTransport: MediaTransport<ResumableUploadTarget> = {
  id: "supabase-tus",
  async put({ file, target, onProgress }) {
    await uploadResumableMedia({
      file,
      target,
      onProgress: (ratio) => onProgress?.({ loaded: Math.round(file.size * ratio), total: file.size, ratio }),
    });
  },
};
