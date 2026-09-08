export function projectMediaLinkScopeFilter(releaseId: string, trackId: string) {
  return `release_id.eq.${releaseId},track_id.eq.${trackId},and(release_id.is.null,track_id.is.null)`;
}
