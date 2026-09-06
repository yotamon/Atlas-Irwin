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
] as const;

/* Mobile keeps four direct workflow destinations plus More. Grow remains a
   first-class destination inside More so the tab bar can never wrap. */
export const ENSEMBLIS_MOBILE_WORK_NAV = [
  ENSEMBLIS_WORK_NAV[0],
  ENSEMBLIS_WORK_NAV[1],
  ENSEMBLIS_WORK_NAV[2],
  ENSEMBLIS_WORK_NAV[3],
] as const;

export const ENSEMBLIS_MORE_NAV = [
  { href: "/studio/audience", label: "Audience", icon: "outreach" },
  { href: "/studio/library", label: "Library", icon: "media" },
  { href: "/studio/memory", label: "Memory", icon: "brand" },
  { href: "/studio/sites", label: "Sites", icon: "sites" },
  { href: "/studio/distribution", label: "Distribution", icon: "distribution" },
  { href: "/studio/connections", label: "Connections", icon: "distribution" },
] as const;

export const ENSEMBLIS_MOBILE_MORE_NAV = [
  ENSEMBLIS_WORK_NAV[4],
  ...ENSEMBLIS_MORE_NAV,
] as const;

// Compatibility alias while older callers still use the previous Manage name.
export const ENSEMBLIS_MANAGE_NAV = ENSEMBLIS_MORE_NAV;

export const ENSEMBLIS_SETTINGS_NAV = {
  href: "/studio/settings",
  label: "Settings",
  icon: "brand",
} as const;

export const ENSEMBLIS_PRIMARY_NAV = ENSEMBLIS_WORK_NAV;

export function ensemblisArtistHref(href: string, artistId: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}artist=${encodeURIComponent(artistId)}`;
}
