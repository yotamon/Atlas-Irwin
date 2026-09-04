import type { ComponentType } from "react";
import { ArtistEditorialTemplate } from "@/components/sites/templates/artist-editorial-v1";
import { DEFAULT_SITE_CONFIG } from "@/lib/sites/domain";
import type { ArtistSiteConfig, SiteViewModel } from "@/types/ensemblis-sites";

export type SiteTemplateCapability =
  | "releases"
  | "artist-profile"
  | "social-links"
  | "contact"
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
