export function deriveContentStatus({
  current,
  publishedAt,
  scheduledAt,
  assetUrl,
  caption,
  hook,
}) {
  if (current === "Archived") return "Archived";
  if (publishedAt || current === "Published") return "Published";
  if (scheduledAt && assetUrl) return "Scheduled";
  if (assetUrl && (caption || hook)) return "Ready";
  if (assetUrl || caption || hook) return "In Production";
  return "Draft";
}

export function approvalPolicy({ paid = false, external = false, destructive = false, reversible = true }) {
  if (destructive) return "confirmation";
  if (paid || external) return "approval";
  if (reversible) return "automatic";
  return "confirmation";
}

export function canAutoFixHealthIssue(kind, context = {}) {
  switch (kind) {
    case "release_cover_from_single_asset":
    case "release_cover_alt":
    case "release_link_mirror":
      return true;
    case "homepage_default_from_single_track":
      return context.singleCandidate === true;
    case "spotify_exact_isrc":
      return context.uniqueExactMatch === true;
    default:
      return false;
  }
}
