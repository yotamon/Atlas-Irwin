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
  name: string;
  description: string;
  supports: SiteTemplateCapability[];
  defaults: ArtistSiteConfig;
  render: ComponentType<SiteTemplateProps>;
};

const templates = [
  {
    key: "artist-editorial-v1",
    name: "Artist Editorial",
    description: "A confident music-first artist site with editorial release storytelling and restrained motion-free presentation.",
    supports: ["releases", "artist-profile", "social-links", "contact", "seo"],
    defaults: DEFAULT_SITE_CONFIG,
    render: ArtistEditorialTemplate,
  } satisfies SiteTemplateDefinition,
] as const;

const templateByKey = new Map<string, SiteTemplateDefinition>(
  templates.map((template) => [template.key, template]),
);

export function listSiteTemplates() {
  return [...templates];
}

export function getSiteTemplate(key: string): SiteTemplateDefinition {
  const template = templateByKey.get(key);
  if (!template) throw new Error(`Unknown Ensemblis site template: ${key}`);
  return template;
}
