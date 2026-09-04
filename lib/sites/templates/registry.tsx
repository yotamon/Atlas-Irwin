import type { ComponentType } from "react";
import { ArtistEditorialTemplate } from "@/components/sites/templates/artist-editorial-v1";
import { EditorialRetrofutureTemplate } from "@/components/sites/templates/editorial-retrofuture-v1";
import { DEFAULT_SITE_CONFIG } from "@/lib/sites/domain";
import type { ArtistSiteConfig, SiteViewModel } from "@/types/ensemblis-sites";

export type SiteTemplateCapability =
  | "releases"
  | "audio-player"
  | "artist-profile"
  | "social-links"
  | "contact"
  | "newsletter"
  | "seo";

export type SiteTemplateProps = {
  config: ArtistSiteConfig;
  viewModel: SiteViewModel;
  preview?: boolean;
};

export type SiteTemplateDefinition = {
  key: string;
  version: number;
  name: string;
  description: string;
  supports: SiteTemplateCapability[];
  defaults: ArtistSiteConfig;
  render: ComponentType<SiteTemplateProps>;
};

export const EDITORIAL_RETROFUTURE_DEFAULT_CONFIG: ArtistSiteConfig = {
  theme: {
    background: "#f4eddd",
    foreground: "#111111",
    muted: "#6f685f",
    accent: "#b6ff3b",
    surface: "#f8f1e4",
  },
  sectionOrder: ["hero", "releases", "platforms", "about", "contact"],
  hiddenSections: [],
  highlightedReleaseIds: [],
  retrofuture: {
    heroTaglines: ["Sound in motion.", "Made to move.", "Built to connect."],
    primaryCtaLabel: "Listen now",
    primaryCtaHref: "#release-widget",
    secondaryCtaLabel: "Contact",
    secondaryCtaHref: "#contact",
    listenHeading: "Listen Everywhere",
    aboutHeading: "Music in motion",
    capabilities: [],
    values: [],
    contactHeading: "Let's Talk",
    contactFormEnabled: false,
    newsletterEnabled: false,
  },
};

const templates = [
  {
    key: "artist-editorial",
    version: 1,
    name: "Artist Editorial",
    description: "A confident music-first artist site with editorial release storytelling and restrained motion-free presentation.",
    supports: ["releases", "artist-profile", "social-links", "contact", "seo"],
    defaults: DEFAULT_SITE_CONFIG,
    render: ArtistEditorialTemplate,
  } satisfies SiteTemplateDefinition,
  {
    key: "editorial-retrofuture",
    version: 1,
    name: "Editorial Retrofuture",
    description: "The production-grade Atlas-derived editorial system: bold typography, tactile release player, platform links, artist story and optional conversion surfaces.",
    supports: ["releases", "audio-player", "artist-profile", "social-links", "contact", "newsletter", "seo"],
    defaults: EDITORIAL_RETROFUTURE_DEFAULT_CONFIG,
    render: EditorialRetrofutureTemplate,
  } satisfies SiteTemplateDefinition,
] as const;

function registryId(key: string, version: number) {
  return `${key}@${version}`;
}

const templateById = new Map<string, SiteTemplateDefinition>(
  templates.map((template) => [registryId(template.key, template.version), template]),
);

export function listSiteTemplates() {
  return [...templates];
}

export function getSiteTemplate(key: string, version: number): SiteTemplateDefinition {
  const template = templateById.get(registryId(key, version));
  if (!template) throw new Error(`Unknown Ensemblis site template: ${key}@${version}`);
  return template;
}

export function getLatestSiteTemplate(key: string): SiteTemplateDefinition {
  const matches = templates.filter((template) => template.key === key);
  const template = matches.sort((left, right) => right.version - left.version)[0];
  if (!template) throw new Error(`Unknown Ensemblis site template: ${key}`);
  return template;
}
