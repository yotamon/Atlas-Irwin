"use server";

import { z } from "zod";
import { saveReleaseV2 } from "@/app/studio/release-actions-v2";
import type { ActionFormState } from "@/lib/studio/form-state";

const requiredText = z.string().trim().min(1, "This field is required.").max(300, "Keep this under 300 characters.");
const optionalUrl = z.union([z.literal(""), z.url()]);
const optionalSlug = z.union([
  z.literal(""),
  z.string().trim().regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only."),
]);

const releaseFormSchema = z.object({
  title: requiredText,
  release_type: requiredText,
  slug: optionalSlug,
  spotify_url: optionalUrl,
  soundcloud_url: optionalUrl,
  youtube_url: optionalUrl,
  smart_link_url: optionalUrl,
  artwork_url: optionalUrl,
});

function stringValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveReleaseV2WithState(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = releaseFormSchema.safeParse({
    title: stringValue(formData, "title"),
    release_type: stringValue(formData, "release_type") || "Single",
    slug: stringValue(formData, "slug"),
    spotify_url: stringValue(formData, "spotify_url"),
    soundcloud_url: stringValue(formData, "soundcloud_url"),
    youtube_url: stringValue(formData, "youtube_url"),
    smart_link_url: stringValue(formData, "smart_link_url"),
    artwork_url: stringValue(formData, "artwork_url"),
  });

  if (!parsed.success) {
    return {
      errors: z.flattenError(parsed.error).fieldErrors,
      message: "Please check the highlighted fields and try again.",
    };
  }

  await saveReleaseV2(formData);
  return { errors: {} };
}
