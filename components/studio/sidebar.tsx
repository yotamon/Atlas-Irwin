import Link from "next/link";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ArtistSwitcher } from "./artist-switcher";
import { studioIcons } from "./icons";
import { StudioAdvancedNavigation, StudioPrimaryNavigation } from "./sidebar-navigation";
import { signOut } from "@/app/studio/actions";
import {
  ENSEMBLIS_MANAGE_NAV,
  ENSEMBLIS_PRODUCT,
  ENSEMBLIS_SETTINGS_NAV,
  ENSEMBLIS_WORK_NAV,
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

function navigationItems(
  items: ReadonlyArray<{ href: string; label: string; icon: keyof typeof studioIcons }>,
  artistId: string,
) {
  return items.map(({ href, label, icon }) => ({
    route: href,
    href: ensemblisArtistHref(href, artistId),
    label,
    icon,
  }));
}

export function StudioSidebar({ artistId, artists }: StudioSidebarProps) {
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;
  const workNavigation = navigationItems(ENSEMBLIS_WORK_NAV, artistId);
  const manageNavigation = navigationItems(ENSEMBLIS_MANAGE_NAV, artistId);
  const settingsNavigation = {
    route: ENSEMBLIS_SETTINGS_NAV.href,
    href: ensemblisArtistHref(ENSEMBLIS_SETTINGS_NAV.href, artistId),
    label: ENSEMBLIS_SETTINGS_NAV.label,
    icon: ENSEMBLIS_SETTINGS_NAV.icon,
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

      <div className="ensemblis-sidebar-group">
        <span className="studio-sidebar-section-label">Work</span>
        <StudioPrimaryNavigation items={workNavigation} />
      </div>

      <div className="ensemblis-sidebar-group ensemblis-sidebar-manage">
        <span className="studio-sidebar-section-label">Manage</span>
        <StudioPrimaryNavigation items={manageNavigation} />
      </div>

      <div className="studio-sidebar-foot">
        <div className="ensemblis-sidebar-settings">
          <StudioAdvancedNavigation item={settingsNavigation} />
        </div>
        <Link href={ensemblisArtistHref("/studio/growth/import", artistId)} className="studio-quick">
          <Plus aria-hidden />
          <span className="studio-nav-text">Add unreleased tracks</span>
        </Link>
        <form action={signOut}>
          <button>
            <Logout aria-hidden />
            <span className="studio-nav-text">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
