"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSocialPlatformKey } from "@/lib/marketing/social-platforms";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { disconnectSocialPlatform } from "@/lib/studio/social-connections";

export async function disconnectSocialConnection(form: FormData) {
  const platform = String(form.get("platform") ?? "").trim();
  if (!isSocialPlatformKey(platform)) throw new Error("Unsupported social platform.");
  const requestedArtistId = String(form.get("artist_id") ?? "").trim() || undefined;
  const artist = await requireArtistContext(requestedArtistId);
  await disconnectSocialPlatform(artist.userId, artist.artistId, platform);
  revalidatePath("/studio/settings");
  revalidatePath(`/studio/settings/social/${platform}`);
  redirect(`/studio/settings?social_disconnected=1&artist_id=${encodeURIComponent(artist.artistId)}`);
}
