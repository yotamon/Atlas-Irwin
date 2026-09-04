import { z } from "zod";
import type {
  ArtistSiteConfig,
  SiteViewModel,
} from "@/types/ensemblis-sites";

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const sectionKey = z.enum(["hero", "releases", "about", "links", "contact"]);

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
});

const siteViewModelSchema = z.object({
  schemaVersion: z.literal(1),
  artist: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    bio: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
    accentColor: hexColor.nullable(),
  }),
  releases: z.array(z.object({
    id: z.string().uuid(),
    slug: z.string().min(1),
    title: z.string().min(1),
    releaseType: z.string().min(1),
    releaseDate: z.string().nullable(),
    story: z.string().nullable(),
    artworkUrl: z.string().url().nullable(),
    genre: z.string().nullable(),
    links: z.array(z.object({
      label: z.string().min(1),
      href: z.string().url(),
      provider: z.string().min(1),
    })),
  })),
  socialLinks: z.array(z.object({
    label: z.string().min(1),
    href: z.string().url(),
    provider: z.string().min(1),
  })),
  contact: z.object({ email: z.string().email().nullable() }),
  seo: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    imageUrl: z.string().url().nullable(),
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
