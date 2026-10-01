export function masteringFailureMessage(raw: string | null | undefined) {
  const value = raw?.trim() || "";
  const normalized = value.toLowerCase();
  if (
    normalized.includes("entitytoolarge") ||
    normalized.includes("payload too large") ||
    normalized.includes("maximum allowed size") ||
    (normalized.includes("storage/v1/object/upload/sign") && normalized.includes("400 bad request"))
  ) {
    return "The render finished, but the lossless candidate was larger than the current storage limit. Ensemblis now uses a storage-safe lossless format; retry from the untouched source.";
  }
  if (normalized.includes("lossless mastering candidate is still larger")) {
    return "This lossless candidate is still too large for the current storage limit after safe encoding. The untouched source remains canonical.";
  }
  if (normalized.includes("media upload failed")) {
    return "The mastering render finished, but Ensemblis could not save the lossless candidate. Retry from the untouched source.";
  }
  return "The mastering worker could not complete this render. The untouched source remains canonical and safe to retry.";
}
