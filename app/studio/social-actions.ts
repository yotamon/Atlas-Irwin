"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { isSocialPlatformKey } from "@/lib/marketing/social-platforms";
import { disconnectSocialPlatform } from "@/lib/studio/social-connections";

export async function disconnectSocialConnection(form: FormData) {
  const platform = String(form.get("platform") ?? "").trim();
  if (!isSocialPlatformKey(platform)) throw new Error("Unsupported social platform.");
  const { user } = await requireStudioAdmin();
  await disconnectSocialPlatform(user.id, platform);
  revalidatePath("/studio/settings");
  revalidatePath(`/studio/settings/social/${platform}`);
  redirect("/studio/settings?social_disconnected=1");
}
