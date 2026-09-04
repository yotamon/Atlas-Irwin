import type { Json } from "@/types/database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ArtistSiteState = "draft" | "published" | "archived";
export type ArtistSiteVersionStatus = "draft" | "published" | "superseded";
export type ArtistSiteDomainType = "managed" | "custom";
export type ArtistSiteVerificationStatus = "pending" | "verified" | "failed";
export type ArtistSiteSslStatus = "pending" | "active" | "failed";
export type ArtistSiteDeploymentStatus = "requested" | "building" | "ready" | "failed" | "rolled_back";

export type ArtistSite = {
  id: string;
  artist_id: string;
  slug: string;
  template_key: string;
  state: ArtistSiteState;
  published_version_id: string | null;
  draft_version_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtistSiteVersion = {
  id: string;
  site_id: string;
  version_number: number;
  status: ArtistSiteVersionStatus;
  template_key: string;
  template_version: number;
  config: Json;
  content_snapshot: Json;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
};

export type ArtistSiteDomain = {
  id: string;
  site_id: string;
  hostname: string;
  domain_type: ArtistSiteDomainType;
  verification_status: ArtistSiteVerificationStatus;
  ssl_status: ArtistSiteSslStatus;
  is_primary: boolean;
  provider: string | null;
  provider_ref: string | null;
  verification_state: Json;
  last_checked_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtistSiteDeployment = {
  id: string;
  site_id: string;
  version_id: string;
  provider: string;
  provider_ref: string | null;
  status: ArtistSiteDeploymentStatus;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
};

export type SiteTheme = {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  surface: string;
};

export type SiteSectionKey =
  | "hero"
  | "releases"
  | "platforms"
  | "about"
  | "links"
  | "contact"
  | "newsletter";

export type SiteSocialLink = { label: string; href: string; provider: string };

export type SiteRetrofutureContent = {
  logoUrl?: string;
  heroTaglines?: string[];
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  listenHeading?: string;
  platformLinks?: SiteSocialLink[];
  aboutHeading?: string;
  aboutParagraphs?: string[];
  aboutImageUrl?: string;
  aboutImageAlt?: string;
  capabilities?: string[];
  values?: string[];
  contactHeading?: string;
  contactCopy?: string;
  contactEmail?: string;
  contactFormEnabled?: boolean;
  contactFormEndpoint?: string;
  newsletterEnabled?: boolean;
  newsletterEndpoint?: string;
  newsletterKicker?: string;
  newsletterHeading?: string;
  newsletterCopy?: string;
};

export type ArtistSiteConfig = {
  theme: SiteTheme;
  sectionOrder: SiteSectionKey[];
  hiddenSections: SiteSectionKey[];
  highlightedReleaseIds: string[];
  heroEyebrow?: string;
  heroCopy?: string;
  retrofuture?: SiteRetrofutureContent;
};

export type SiteArtistProfile = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  accentColor: string | null;
};

export type SiteReleaseLink = { label: string; href: string; provider: string };

export type SiteTrackCard = {
  id: string;
  title: string;
  trackNumber: number | null;
  displayOrder: number;
  durationSeconds: number | null;
  audioUrl: string | null;
  soundcloudUrl: string | null;
  spotifyUrl: string | null;
  isPrimary: boolean;
};

export type SiteReleaseCard = {
  id: string;
  slug: string;
  title: string;
  releaseType: string;
  releaseDate: string | null;
  story: string | null;
  artworkUrl: string | null;
  genre: string | null;
  links: SiteReleaseLink[];
  tracks?: SiteTrackCard[];
};

export type SiteViewModel = {
  schemaVersion: 1;
  artist: SiteArtistProfile;
  releases: SiteReleaseCard[];
  socialLinks: SiteSocialLink[];
  contact: { email: string | null };
  seo: { title: string; description: string; imageUrl: string | null };
};

type Rpc<Args, Returns> = { Args: Args; Returns: Returns };

export type EnsemblisSitesDatabase = {
  public: {
    Tables: {
      artist_sites: Table<ArtistSite>;
      artist_site_versions: Table<ArtistSiteVersion>;
      artist_site_domains: Table<ArtistSiteDomain>;
      artist_site_deployments: Table<ArtistSiteDeployment>;
    };
    Views: Record<string, never>;
    Functions: {
      publish_artist_site: Rpc<{ target_site_id: string; target_version_id: string }, string>;
      create_artist_site_draft: Rpc<{ target_site_id: string }, string>;
      rollback_artist_site: Rpc<{ target_site_id: string; source_version_id: string }, string>;
      set_artist_site_primary_domain: Rpc<{ target_site_id: string; target_domain_id: string }, string>;
      resolve_artist_site_hostname: Rpc<{ target_hostname: string }, Array<{ site_id: string; site_slug: string }>>;
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
