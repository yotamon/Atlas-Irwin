import { z } from "zod";
import type {
  ArtistSiteConfig,
  SiteViewModel,
} from "@/types/ensemblis-sites";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const sectionKey = z.enum([
  "hero",
  "releases",
  "platforms",
  "about",
  "links",
  "contact",
  "newsletter",
]);
const publicUrl = z.string().url();
const siteAsset = z.string().min(1).max(500).regex(/^(?:\/|https?:\/\/)/i);
const siteHref = z.string().min(1).max(500).regex(/^(?:#|\/|https?:\/\/|mailto:)/i);
const internalApiEndpoint = z.string().min(1).max(200).regex(/^\/api\//);

export const DEFAULT_SITE_CONFIG: ArtistSiteConfig = {
  theme: {
    background: "#11110f",
    foreground: "#f5f1e8",
    muted: "#aaa59b",
    accent: "#f3b61f",
    surface: "#1b1a17",
  },
  sectionOrder: ["hero", "releases", "about", "links", "contact"],
  hiddenSections: [],
  highlightedReleaseIds: [],
};

const socialLinkSchema = z.object({
  label: z.string().min(1).max(80),
  href: publicUrl,
  provider: z.string().min(1).max(80),
});

const retrofutureSchema = z.object({
  logoUrl: siteAsset.optional(),
  heroTaglines: z.array(z.string().min(1).max(100)).max(6).optional(),
  primaryCtaLabel: z.string().min(1).max(80).optional(),
  primaryCtaHref: siteHref.optional(),
  secondaryCtaLabel: z.string().min(1).max(80).optional(),
  secondaryCtaHref: siteHref.optional(),
  listenHeading: z.string().min(1).max(100).optional(),
  platformLinks: z.array(socialLinkSchema).max(12).optional(),
  aboutHeading: z.string().min(1).max(160).optional(),
  aboutParagraphs: z.array(z.string().min(1).max(700)).max(8).optional(),
  aboutImageUrl: siteAsset.optional(),
  aboutImageAlt: z.string().min(1).max(180).optional(),
  capabilities: z.array(z.string().min(1).max(100)).max(16).optional(),
  values: z.array(z.string().min(1).max(100)).max(6).optional(),
  contactHeading: z.string().min(1).max(100).optional(),
  contactCopy: z.string().min(1).max(500).optional(),
  contactEmail: z.string().email().optional(),
  contactFormEnabled: z.boolean().optional(),
  contactFormEndpoint: internalApiEndpoint.optional(),
  newsletterEnabled: z.boolean().optional(),
  newsletterEndpoint: internalApiEndpoint.optional(),
  newsletterKicker: z.string().min(1).max(80).optional(),
  newsletterHeading: z.string().min(1).max(120).optional(),
  newsletterCopy: z.string().min(1).max(500).optional(),
}).strict();

const siteConfigSchema = z.object({
  theme: z.object({
    background: hexColor,
    foreground: hexColor,
    muted: hexColor,
    accent: hexColor,
    surface: hexColor,
  }),
  sectionOrder: z.array(sectionKey).min(1),
  hiddenSections: z.array(sectionKey),
  highlightedReleaseIds: z.array(z.string().uuid()),
  heroEyebrow: z.string().max(80).optional(),
  heroCopy: z.string().max(320).optional(),
  retrofuture: retrofutureSchema.optional(),
});

const trackSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  trackNumber: z.number().int().positive().nullable(),
  displayOrder: z.number().int().default(0),
  durationSeconds: z.number().nonnegative().nullable(),
  audioUrl: siteAsset.nullable(),
  soundcloudUrl: publicUrl.nullable(),
  spotifyUrl: publicUrl.nullable(),
  isPrimary: z.boolean(),
});

const siteViewModelSchema = z.object({
  schemaVersion: z.literal(1),
  artist: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    bio: z.string().nullable(),
    avatarUrl: siteAsset.nullable(),
    accentColor: hexColor.nullable(),
  }),
  releases: z.array(z.object({
    id: z.string().uuid(),
    slug: z.string().min(1),
    title: z.string().min(1),
    releaseType: z.string().min(1),
    releaseDate: z.string().nullable(),
    story: z.string().nullable(),
    artworkUrl: siteAsset.nullable(),
    genre: z.string().nullable(),
    links: z.array(z.object({
      label: z.string().min(1),
      href: publicUrl,
      provider: z.string().min(1),
    })),
    tracks: z.array(trackSchema).default([]),
  })),
  socialLinks: z.array(socialLinkSchema),
  contact: z.object({ email: z.string().email().nullable() }),
  seo: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    imageUrl: publicUrl.nullable(),
  }),
});

export function parseSiteConfig(value: unknown): ArtistSiteConfig {
  const parsed = siteConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SITE_CONFIG;
}

export function parseSiteViewModel(value: unknown): SiteViewModel {
  return siteViewModelSchema.parse(value);
}

export function normalizeSiteSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "artist";
}
