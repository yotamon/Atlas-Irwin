export const ENSEMBLIS_PRODUCT = {
  name: "Ensemblis",
  descriptor: "Music-aware artist growth",
  positioning: "The platform that understands the song before it markets it.",
  promise: "Everything behind your music, working together.",
} as const;

export const ENSEMBLIS_ACTIVE_ARTIST_COOKIE = "ensemblis_active_artist";

/**
 * Artist-facing information architecture.
 *
 * Today is the operating surface, Music owns source material plus release
 * collections, and Grow owns audience/outcome work. Create stays an action,
 * not a destination competing with the places where work lives.
 */
export const ENSEMBLIS_WORK_NAV = [
  { href: "/studio", label: "Today", icon: "dashboard" },
  { href: "/studio/music", label: "Music", icon: "musicLab" },
  { href: "/studio/growth", label: "Grow", icon: "analytics" },
] as const;

export const ENSEMBLIS_MOBILE_WORK_NAV = ENSEMBLIS_WORK_NAV;

export const ENSEMBLIS_CREATE_ACTION = {
  href: "/studio/create",
  label: "Create",
  icon: "content",
} as const;

/** Cross-workflow utilities belong in More. */
export const ENSEMBLIS_MORE_NAV = [
  { href: "/studio/library", label: "Library", icon: "media" },
  { href: "/studio/sites", label: "Sites", icon: "sites" },
] as const;

export const ENSEMBLIS_MOBILE_MORE_NAV = ENSEMBLIS_MORE_NAV;

// Compatibility alias while older callers still use the previous Manage name.
export const ENSEMBLIS_MANAGE_NAV = ENSEMBLIS_MORE_NAV;

export const ENSEMBLIS_SETTINGS_NAV = {
  href: "/studio/settings",
  label: "Settings",
  icon: "brand",
} as const;

export const ENSEMBLIS_PRIMARY_NAV = ENSEMBLIS_WORK_NAV;

type RouteContext = {
  prefix: string;
  area: string;
  parentHref: string;
};

/**
 * Specialist surfaces keep a visible parent so deep links never feel detached
 * from the primary product model.
 */
export const ENSEMBLIS_ROUTE_CONTEXTS: readonly RouteContext[] = [
  { prefix: "/studio/needs-you", area: "Today", parentHref: "/studio" },
  { prefix: "/studio/inbox", area: "Today", parentHref: "/studio" },
  { prefix: "/studio/autopilot", area: "Today", parentHref: "/studio" },
  { prefix: "/studio/music", area: "Music", parentHref: "/studio/music" },
  { prefix: "/studio/releases", area: "Music", parentHref: "/studio/music" },
  { prefix: "/studio/distribution", area: "Music", parentHref: "/studio/music" },
  { prefix: "/studio/create", area: "Create", parentHref: "/studio/create" },
  { prefix: "/studio/video", area: "Create", parentHref: "/studio/create" },
  { prefix: "/studio/production", area: "Create", parentHref: "/studio/create" },
  { prefix: "/studio/content", area: "Create", parentHref: "/studio/create" },
  { prefix: "/studio/growth", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/analytics", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/audience", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/campaigns", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/calendar", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/outreach", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/learn", area: "Grow", parentHref: "/studio/growth" },
  { prefix: "/studio/library", area: "Library", parentHref: "/studio/library" },
  { prefix: "/studio/sites", area: "Sites", parentHref: "/studio/sites" },
  { prefix: "/studio/settings", area: "Settings", parentHref: "/studio/settings" },
  { prefix: "/studio/connections", area: "Settings", parentHref: "/studio/settings" },
  { prefix: "/studio/brand", area: "Settings", parentHref: "/studio/settings" },
  { prefix: "/studio/memory", area: "Settings", parentHref: "/studio/settings" },
  { prefix: "/studio/data-health", area: "Settings", parentHref: "/studio/settings" },
];

function normalizedPathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function routeMatches(pathname: string, prefix: string) {
  const normalized = normalizedPathname(pathname);
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

export function resolveEnsemblisRouteContext(pathname: string) {
  const normalized = normalizedPathname(pathname);
  if (normalized === "/studio") {
    return { area: "Today", parentHref: "/studio", detail: null };
  }
  const context = ENSEMBLIS_ROUTE_CONTEXTS
    .filter((candidate) => routeMatches(normalized, candidate.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
  if (!context) return { area: "Studio", parentHref: "/studio", detail: null };

  const remainder = normalized.slice(context.prefix.length).split("/").filter(Boolean);
  const detail = remainder.length
    ? remainder[0]
        .replaceAll("-", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase())
    : context.prefix === context.parentHref
      ? null
      : context.prefix.split("/").at(-1)?.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase()) ?? null;

  return { area: context.area, parentHref: context.parentHref, detail };
}

/**
 * Switching artist intentionally drops object IDs and workflow-specific query
 * state. The user remains in the same broad area without carrying stale release,
 * track, campaign, or editor identifiers from the previous artist.
 */
export function ensemblisArtistSwitchHref(pathname: string, artistId: string) {
  const context = resolveEnsemblisRouteContext(pathname);
  return ensemblisArtistHref(context.parentHref, artistId);
}

export function ensemblisArtistHref(href: string, artistId: string) {
  const hashIndex = href.indexOf("#");
  const base = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const fragment = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const queryIndex = base.indexOf("?");
  const pathname = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
  const query = queryIndex >= 0 ? base.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  params.set("artist", artistId);
  const serialized = params.toString();
  return `${pathname}${serialized ? `?${serialized}` : ""}${fragment}`;
}
