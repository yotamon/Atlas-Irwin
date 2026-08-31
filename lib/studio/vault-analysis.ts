import "server-only";

import { mediaWorkerReadiness } from "@/lib/media-worker/sandbox";

export function vaultAnalysisReadiness() {
  return { configured: mediaWorkerReadiness().configured };
}
