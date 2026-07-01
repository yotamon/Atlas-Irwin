import type { Release } from "@/lib/releases/types";
import { getSiteUrl } from "@/lib/site-url";

function toIsoDate(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}

function toIsoDuration(value?: string) {
  if (!value) return undefined;
  const parts = value.split(":").map((part) => Number(part));
  if (parts.length !== 2 || parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  const [minutes, seconds] = parts;
  return `PT${minutes}M${seconds}S`;
}

export function buildMusicAlbumJsonLd(releases: Release[]) {
  const siteUrl = getSiteUrl();

  return releases.map((release) => ({
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: release.title,
    byArtist: {
      "@type": "MusicGroup",
      name: release.artist || "Atlas Irwin",
      url: siteUrl,
    },
    ...(release.releaseDate ? { datePublished: toIsoDate(release.releaseDate) } : {}),
    ...(release.genre ? { genre: release.genre } : {}),
    image: release.coverUrl.startsWith("http")
      ? release.coverUrl
      : `${siteUrl}${release.coverUrl}`,
    numTracks: release.trackCount,
    track: release.tracks.map((track, index) => ({
      "@type": "MusicRecording",
      name: track.title,
      position: index + 1,
      ...(toIsoDuration(track.duration)
        ? { duration: toIsoDuration(track.duration) }
        : {}),
      ...(track.url ? { url: track.url } : {}),
    })),
    ...(release.albumLinks[0]?.href ? { url: release.albumLinks[0].href } : {}),
  }));
}
