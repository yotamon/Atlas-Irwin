import Link from "next/link";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ArtistSwitcher } from "./artist-switcher";
import { studioIcons } from "./icons";
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
  const Distribution = studioIcons.distribution;

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
      <nav aria-label="Ensemblis primary navigation">
        {ENSEMBLIS_PRIMARY_NAV.map(({ href, label, icon }) => {
          const Icon = studioIcons[icon];
          return (
            <Link href={ensemblisArtistHref(href, artistId)} key={href}>
              <Icon aria-hidden />
              <span className="studio-nav-text">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="studio-sidebar-foot">
        <div className="studio-sidebar-advanced">
          <span className="studio-sidebar-section-label">Advanced</span>
          <Link href={ensemblisArtistHref("/studio/distribution", artistId)}>
            <Distribution aria-hidden />
            Distribution
          </Link>
        </div>
        <Link href={ensemblisArtistHref("/studio/growth/import", artistId)} className="studio-quick">
          <Plus aria-hidden />
          Add unreleased tracks
        </Link>
        <form action={signOut}>
          <button><Logout aria-hidden />Sign out</button>
        </form>
      </div>
    </aside>
  );
}
