import Link from "next/link";
import { studioIcons } from "./icons";
import { signOut } from "@/app/studio/actions";
import { ENSEMBLIS_PRIMARY_NAV, ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";

type StudioSidebarProps = {
  artistName: string;
  workspaceName: string;
};

export function StudioSidebar({ artistName, workspaceName }: StudioSidebarProps) {
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;
  const Distribution = studioIcons.distribution;

  return (
    <aside className="studio-sidebar studio-sidebar-v2">
      <Link href="/studio" className="studio-mark ensemblis-product-mark" aria-label={`${ENSEMBLIS_PRODUCT.name} home`}>
        <span className="ensemblis-mark-symbol" aria-hidden>E</span>
        <span className="ensemblis-wordmark">
          <strong>{ENSEMBLIS_PRODUCT.name}</strong>
          <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
        </span>
      </Link>

      <div className="studio-artist-context" aria-label="Active artist">
        <span>Active artist</span>
        <strong>{artistName}</strong>
        <small>{workspaceName}</small>
      </div>

      <span className="studio-sidebar-section-label">Workspace</span>
      <nav aria-label="Ensemblis primary navigation">
        {ENSEMBLIS_PRIMARY_NAV.map(({ href, label, icon }) => {
          const Icon = studioIcons[icon];
          return (
            <Link href={href} key={href}>
              <Icon aria-hidden />
              <span className="studio-nav-text">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="studio-sidebar-foot">
        <div className="studio-sidebar-advanced">
          <span className="studio-sidebar-section-label">Advanced</span>
          <Link href="/studio/distribution">
            <Distribution aria-hidden />
            Distribution
          </Link>
        </div>
        <Link href="/studio/growth/import" className="studio-quick">
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
