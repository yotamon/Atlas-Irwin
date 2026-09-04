export const ENSEMBLIS_PRODUCT = {
  name: "Ensemblis",
  descriptor: "Music-aware artist growth",
  positioning: "The platform that understands the song before it markets it.",
  promise: "Everything behind your music, working together.",
} as const;

export const ENSEMBLIS_ACTIVE_ARTIST_COOKIE = "ensemblis_active_artist";

export const ENSEMBLIS_PRIMARY_NAV = [
  { href: "/studio", label: "Today", icon: "dashboard" },
  { href: "/studio/music", label: "Music", icon: "musicLab" },
  { href: "/studio/releases", label: "Releases", icon: "releases" },
  { href: "/studio/create", label: "Create", icon: "content" },
  { href: "/studio/growth", label: "Growth", icon: "analytics" },
  { href: "/studio/audience", label: "Audience", icon: "outreach" },
  { href: "/studio/library", label: "Library", icon: "media" },
  { href: "/studio/connections", label: "Connections", icon: "distribution" },
  { href: "/studio/settings", label: "Settings", icon: "brand" },
] as const;

export function ensemblisArtistHref(href: string, artistId: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}artist=${encodeURIComponent(artistId)}`;
}
