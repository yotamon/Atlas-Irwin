"use server";

import { redirect } from "next/navigation";
import { publishRelease as publishReleaseUnsafe } from "./catalog-actions";

export * from "./catalog-actions";

/**
 * Treat release-readiness failures as expected validation, not runtime errors.
 *
 * The canonical publish action deliberately enforces readiness and throws when
 * blockers remain. When invoked from a Server Action form that expected error
 * would otherwise trip the Studio error boundary. Intercept only that known
 * validation case and send the editor back to the readiness panel. Unexpected
 * failures still propagate normally so they remain observable in Vercel.
 */
export async function publishRelease(form: FormData) {
  try {
    return await publishReleaseUnsafe(form);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Release is not ready to publish:")
    ) {
      const releaseId = String(form.get("release_id") ?? "").trim();
      const destination = releaseId
        ? `/studio/releases/${encodeURIComponent(releaseId)}?tab=overview&publish=blocked#readiness`
        : "/studio/releases";
      redirect(destination);
    }
    throw error;
  }
}
