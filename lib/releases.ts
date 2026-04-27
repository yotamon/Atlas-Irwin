import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const RELEASES_DIR = path.join(process.cwd(), "public", "releases");
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

type ReleaseManifestTrack = {
  file: string;
  title?: string;
  duration?: string;
  active?: boolean;
  links?: ReleaseManifestLink[];
};

type ReleaseManifestLink = {
  platform: string;
  href: string;
  label?: string;
};

type ReleaseManifestPartner = {
  name: string;
  region?: string;
  available?: boolean;
};

type ReleaseManifest = {
  title?: string;
  type?: string;
  artist?: string;
  description?: string;
  releaseDate?: string;
  featured?: boolean;
  cover?: string;
  coverAlt?: string;
  ctaLabel?: string;
  ctaHref?: string;
  genre?: string;
  subgenre?: string;
  label?: string;
  upc?: string;
  artistLinks?: ReleaseManifestLink[];
  albumLinks?: ReleaseManifestLink[];
  partners?: ReleaseManifestPartner[];
  tracks?: ReleaseManifestTrack[];
};

export type ReleaseLink = {
  platform: string;
  href: string;
  label: string;
};

export type ReleasePartner = {
  name: string;
  region?: string;
  available: boolean;
};

export type ReleaseTrack = {
  number: string;
  title: string;
  duration?: string;
  file: string;
  url: string;
  active: boolean;
  links: ReleaseLink[];
};

export type Release = {
  slug: string;
  title: string;
  type: string;
  artist: string;
  description?: string;
  releaseDate?: string;
  releaseDateLabel?: string;
  featured: boolean;
  coverUrl: string;
  coverAlt: string;
  ctaLabel?: string;
  ctaHref?: string;
  genre?: string;
  subgenre?: string;
  label?: string;
  upc?: string;
  artistLinks: ReleaseLink[];
  albumLinks: ReleaseLink[];
  partners: ReleasePartner[];
  trackCount: number;
  totalDurationLabel?: string;
  tracks: ReleaseTrack[];
};

export function getReleases(): Release[] {
  if (!existsSync(RELEASES_DIR)) {
    return [];
  }

  return readdirSync(RELEASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => readRelease(entry.name))
    .filter((release): release is Release => release !== null)
    .sort(sortReleases);
}

function readRelease(slug: string): Release | null {
  const releaseDir = path.join(RELEASES_DIR, slug);
  const manifest = readManifest(releaseDir);
  const tracks = readTracks(slug, releaseDir, manifest);

  return {
    slug,
    title: manifest.title?.trim() || formatTitle(slug),
    type: manifest.type?.trim() || inferReleaseType(tracks.length),
    artist: manifest.artist?.trim() || "Atlas Irwin",
    description: manifest.description?.trim(),
    releaseDate: manifest.releaseDate,
    releaseDateLabel: formatReleaseDate(manifest.releaseDate),
    featured: manifest.featured ?? false,
    coverUrl: resolveCoverUrl(slug, releaseDir, manifest),
    coverAlt: manifest.coverAlt?.trim() || `${manifest.title?.trim() || formatTitle(slug)} cover art`,
    ctaLabel: manifest.ctaLabel?.trim(),
    ctaHref: manifest.ctaHref?.trim() || tracks[0]?.url,
    genre: manifest.genre?.trim(),
    subgenre: manifest.subgenre?.trim(),
    label: manifest.label?.trim(),
    upc: manifest.upc?.trim(),
    artistLinks: readLinks(manifest.artistLinks),
    albumLinks: readLinks(manifest.albumLinks),
    partners: readPartners(manifest.partners),
    trackCount: tracks.length,
    totalDurationLabel: formatTotalDuration(tracks),
    tracks,
  };
}

function readManifest(releaseDir: string): ReleaseManifest {
  const manifestPath = path.join(releaseDir, "release.json");

  if (!existsSync(manifestPath)) {
    return {};
  }

  try {
    const rawManifest = readFileSync(manifestPath, "utf8");
    return JSON.parse(rawManifest) as ReleaseManifest;
  } catch {
    return {};
  }
}

function readTracks(slug: string, releaseDir: string, manifest: ReleaseManifest): ReleaseTrack[] {
  const audioDir = path.join(releaseDir, "audio");
  const audioFiles = existsSync(audioDir)
    ? readdirSync(audioDir)
        .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    : [];

  const manifestTracks =
    manifest.tracks?.map((track, index) => {
      const manifestFileName = track.file.trim();

      // Find the actual file on disk that matches this manifest entry.
      // We check for exact match or a match where the disk file has a numeric prefix (e.g., "01-Track.wav" matching "Track.wav").
      const matchedFile = audioFiles.find((f) => {
        if (f === manifestFileName) return true;
        const diskNameWithoutPrefix = f.replace(/^\d+[-_\s]*/, "");
        return diskNameWithoutPrefix === manifestFileName;
      });

      if (!matchedFile) {
        return null;
      }

      return createTrack(slug, matchedFile, index, {
        title: track.title,
        duration: track.duration,
        active: track.active,
        links: track.links,
      });
    }) ?? [];

  const curatedTracks = manifestTracks.filter((track): track is ReleaseTrack => track !== null);

  if (curatedTracks.length > 0) {
    // Sort curated tracks by their actual filename on disk to honor the user's numeric prefixes.
    curatedTracks.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));

    return curatedTracks.map((track, index) => ({
      ...track,
      // Re-assign track number based on final sorted order.
      // deriveTrackNumber prefers filename numbers (01-, 02-) but falls back to index-based.
      number: deriveTrackNumber(track.file, index),
      active: curatedTracks.some((item) => item.active) ? track.active : index === 0,
    }));
  }

  return audioFiles.map((fileName, index) => createTrack(slug, fileName, index, { active: index === 0 }));
}

function createTrack(
  slug: string,
  fileName: string,
  index: number,
  options: {
    title?: string;
    duration?: string;
    active?: boolean;
    links?: ReleaseManifestLink[];
  },
): ReleaseTrack {
  return {
    number: deriveTrackNumber(fileName, index),
    title: options.title?.trim() || formatTitle(path.parse(fileName).name),
    duration: options.duration?.trim(),
    file: fileName,
    url: toPublicPath("releases", slug, "audio", fileName),
    active: options.active ?? false,
    links: readLinks(options.links),
  };
}

function readLinks(links?: ReleaseManifestLink[]): ReleaseLink[] {
  return (
    links
      ?.filter((link) => link.platform?.trim() && link.href?.trim())
      .map((link) => ({
        platform: link.platform.trim(),
        href: link.href.trim(),
        label: link.label?.trim() || link.platform.trim(),
      })) ?? []
  );
}

function readPartners(partners?: ReleaseManifestPartner[]): ReleasePartner[] {
  return (
    partners
      ?.filter((partner) => partner.name?.trim())
      .map((partner) => ({
        name: partner.name.trim(),
        region: partner.region?.trim(),
        available: partner.available ?? false,
      })) ?? []
  );
}

function resolveCoverUrl(slug: string, releaseDir: string, manifest: ReleaseManifest): string {
  if (manifest.cover?.trim()) {
    return /^https?:\/\//.test(manifest.cover) || manifest.cover.startsWith("/")
      ? manifest.cover
      : toPublicPath("releases", slug, manifest.cover);
  }

  const imageFiles = readdirSync(releaseDir)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((left, right) => {
      const leftScore = left.toLowerCase().startsWith("cover") ? 0 : 1;
      const rightScore = right.toLowerCase().startsWith("cover") ? 0 : 1;
      return leftScore - rightScore || left.localeCompare(right);
    });

  return imageFiles[0] ? toPublicPath("releases", slug, imageFiles[0]) : "/atlas-cover.png";
}

function deriveTrackNumber(fileName: string, index: number): string {
  const match = path.parse(fileName).name.match(/^(\d{1,2})/);

  if (match) {
    return match[1].padStart(2, "0");
  }

  return String(index + 1).padStart(2, "0");
}

function formatTitle(value: string): string {
  return value
    .replace(/^[-_\s\d]+/, "")
    .split(/[-_]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function inferReleaseType(trackCount: number): string {
  if (trackCount === 1) {
    return "Single";
  }

  if (trackCount >= 2 && trackCount <= 6) {
    return "EP";
  }

  if (trackCount >= 7) {
    return "Album";
  }

  return "Release";
}

function formatReleaseDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

function formatTotalDuration(tracks: ReleaseTrack[]): string | undefined {
  const totalSeconds = tracks.reduce<number>((sum, track) => {
    const durationInSeconds = parseDuration(track.duration);
    return durationInSeconds === null ? sum : sum + durationInSeconds;
  }, 0);

  const allDurationsKnown =
    tracks.length > 0 && tracks.every((track) => parseDuration(track.duration) !== null);

  if (!allDurationsKnown || totalSeconds <= 0) {
    return undefined;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  return `${totalMinutes} Min`;
}

function parseDuration(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":").map((part) => Number(part));

  if (parts.length !== 2 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return parts[0] * 60 + parts[1];
}

function sortReleases(left: Release, right: Release): number {
  if (left.featured !== right.featured) {
    return Number(right.featured) - Number(left.featured);
  }

  const leftTime = left.releaseDate ? Date.parse(left.releaseDate) : 0;
  const rightTime = right.releaseDate ? Date.parse(right.releaseDate) : 0;

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.title.localeCompare(right.title);
}

function toPublicPath(...segments: string[]): string {
  return `/${segments
    .flatMap((segment) => segment.split(/[\\/]+/))
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}
