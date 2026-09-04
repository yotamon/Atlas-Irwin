import Link from "next/link";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ArtistSwitcher } from "./artist-switcher";
import { studioIcons } from "./icons";
import { StudioAdvancedNavigation, StudioPrimaryNavigation } from "./sidebar-navigation";
import { signOut } from "@/app/studio/actions";
import {
  ENSEMBLIS_PRIMARY_NAV,
  ENSEMBLIS_PRODUCT,
  ensemblisArtistHref,
} from "@/lib/ensemblis-product";

type StudioSidebarProps = {
  artistId: string;
  artists: Array<{
    artistId: string;
    artistName: string;
    workspaceName: string;
  }>;
};

export function StudioSidebar({ artistId, artists }: StudioSidebarProps) {
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;
  const primaryNavigation = ENSEMBLIS_PRIMARY_NAV.map(({ href, label, icon }) => ({
    route: href,
    href: ensemblisArtistHref(href, artistId),
    label,
    icon,
  }));
  const distributionNavigation = {
    route: "/studio/distribution",
    href: ensemblisArtistHref("/studio/distribution", artistId),
    label: "Distribution",
    icon: "distribution" as const,
  };

  return (
    <aside className="studio-sidebar studio-sidebar-v2">
      <Link
        href={ensemblisArtistHref("/studio", artistId)}
        className="studio-mark ensemblis-product-mark"
        aria-label={`${ENSEMBLIS_PRODUCT.name} home`}
      >
        <span className="ensemblis-mark-symbol" aria-hidden>
          <EnsemblisMark />
        </span>
        <span className="ensemblis-wordmark">
          <strong>{ENSEMBLIS_PRODUCT.name}</strong>
          <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
        </span>
      </Link>

      <ArtistSwitcher activeArtistId={artistId} artists={artists} />

      <span className="studio-sidebar-section-label">Workspace</span>
      <StudioPrimaryNavigation items={primaryNavigation} />

      <div className="studio-sidebar-foot">
        <div className="studio-sidebar-advanced">
          <span className="studio-sidebar-section-label">Advanced</span>
          <StudioAdvancedNavigation item={distributionNavigation} />
        </div>
        <Link href={ensemblisArtistHref("/studio/growth/import", artistId)} className="studio-quick">
          <Plus aria-hidden />
          <span className="studio-nav-text">Add unreleased tracks</span>
        </Link>
        <form action={signOut}>
          <button><Logout aria-hidden /><span className="studio-nav-text">Sign out</span></button>
        </form>
      </div>
    </aside>
  );
}
