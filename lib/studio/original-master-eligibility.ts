/**
 * A media asset is not automatically a source recording. The same shared
 * Library stores derivatives, mastered variants and DJ mixes; importing them as
 * unrelated source tracks would corrupt a release catalog.
 */
export type SourceMasterEligibility = { allowed: true } | { allowed: false; reason: string };

export function originalMasterEligibility(input: {
  assetType: string;
  mimeType: string | null;
  metadata: unknown;
  artistId: string;
}): SourceMasterEligibility {
  if (input.assetType !== "master_audio" || !input.mimeType?.startsWith("audio/")) {
    return { allowed: false, reason: "Choose an actual master_audio recording, not a stem or preview." };
  }

  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase())
    : [];
  const uploadSource = typeof metadata.upload_source === "string" ? metadata.upload_source.toLowerCase() : "";
  const requiredArtistTag = `artist:${input.artistId}`.toLowerCase();

  if (!tags.includes(requiredArtistTag)) {
    return {
      allowed: false,
      reason: "This asset has no explicit ownership tag for the active artist. Import a correctly scoped original recording instead.",
    };
  }

  const derivedMarkers = new Set([
    "active-mastering", "automix", "dj-mix", "mastering-reference",
    "mastering-preview", "analysis-preview", "mix-preview",
  ]);
  if (tags.some((tag) => derivedMarkers.has(tag))
    || ["active-mastering", "automix", "mastering-reference"].includes(uploadSource)) {
    return {
      allowed: false,
      reason: "This audio is a mastering or mix derivative, not a new source track. Reuse it through its existing mastering or mix workflow.",
    };
  }

  return { allowed: true };
}
