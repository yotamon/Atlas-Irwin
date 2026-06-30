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
  source: "local" | "soundcloud";
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
  canvasVideoUrl?: string;
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
  sortUpdatedAtMs: number;
};
