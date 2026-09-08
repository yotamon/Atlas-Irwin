"use server";

import { requireStudioAdmin } from "@/lib/auth/studio";

function value(form: FormData, key: string, max = 500) {
  return String(form.get(key) ?? "").trim().slice(0, max);
}

export async function reportMediaUploadTransportFailure(form: FormData) {
  const { user } = await requireStudioAdmin();
  const diagnostic = {
    event: "media_upload_transport_failure",
    userId: user.id,
    transport: value(form, "transport", 40),
    stage: value(form, "stage", 80),
    errorName: value(form, "error_name", 120),
    errorMessage: value(form, "error_message", 500),
    mimeType: value(form, "mime_type", 160),
    fileSize: Number(value(form, "file_size", 24)) || 0,
    progress: Number(value(form, "progress", 24)) || 0,
    online: value(form, "online", 12),
    userAgent: value(form, "user_agent", 300),
    occurredAt: new Date().toISOString(),
  };

  console.warn("[media-upload-transport]", JSON.stringify(diagnostic));
}
