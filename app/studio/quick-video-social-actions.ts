"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import { queueQuickVideoSocialPack } from "@/lib/video-director/social-delivery";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function retryQuickVideoSocialPack(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user } = await requireStudioAdmin();
  const db = createServiceClient();
  const context = await loadVideoProjectContext(db, projectId, user.id);
  await queueQuickVideoSocialPack({
    db,
    ownerId: user.id,
    projectId,
  });
  revalidatePath(`/studio/video/${projectId}`);
  revalidatePath(`/studio/releases/${context.release.id}`);
}
