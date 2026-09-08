export function projectMediaLinkScopeFilter(releaseId: string, trackId: string) {
  return `track_id.eq.${trackId},and(release_id.eq.${releaseId},track_id.is.null),and(release_id.is.null,track_id.is.null)`;
}
