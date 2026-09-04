export const ENSEMBLIS_PRODUCT = {
  name: "Ensemblis",
  descriptor: "Music-aware artist growth",
  positioning: "The platform that understands the song before it markets it.",
  promise: "Everything behind your music, working together.",
} as const;

export const ENSEMBLIS_ACTIVE_ARTIST_COOKIE = "ensemblis_active_artist";

export const ENSEMBLIS_WORK_NAV = [
  { href: "/studio", label: "Today", icon: "dashboard" },
  { href: "/studio/music", label: "Music", icon: "musicLab" },
  { href: "/studio/releases", label: "Releases", icon: "releases" },
  { href: "/studio/create", label: "Create", icon: "content" },
  { href: "/studio/growth", label: "Grow", icon: "analytics" },
  { href: "/studio/audience", label: "Audience", icon: "outreach" },
  { href: "/studio/library", label: "Library", icon: "media" },
] as const;

export const ENSEMBLIS_MANAGE_NAV = [
  { href: "/studio/sites", label: "Sites", icon: "sites" },
  { href: "/studio/distribution", label: "Distribution", icon: "distribution" },
  { href: "/studio/connections", label: "Connections", icon: "distribution" },
] as const;

export const ENSEMBLIS_SETTINGS_NAV = {
  href: "/studio/settings",
  label: "Settings",
  icon: "brand",
} as const;

// Compatibility alias for callers that still mean the daily work navigation.
// Manage and Settings are deliberately separate information-architecture groups.
export const ENSEMBLIS_PRIMARY_NAV = ENSEMBLIS_WORK_NAV;

export function ensemblisArtistHref(href: string, artistId: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}artist=${encodeURIComponent(artistId)}`;
}
