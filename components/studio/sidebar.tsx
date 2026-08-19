import Link from "next/link";
import { studioIcons } from "./icons";
import { signOut } from "@/app/studio/actions";

const links = [
  ["/studio", "Today", "dashboard"],
  ["/studio/releases", "Releases", "releases"],
  ["/studio/create", "Create", "musicLab"],
  ["/studio/media", "Library", "media"],
  ["/studio/settings", "Settings", "brand"],
] as const;

export function StudioSidebar() {
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;
  return (
    <aside className="studio-sidebar studio-sidebar-v2">
      <Link href="/studio" className="studio-mark">
        <span>
          ATLAS<small>STUDIO</small>
        </span>
      </Link>
      <nav aria-label="Studio">
        {links.map(([href, label, key]) => {
          const Icon = studioIcons[key];
          return (
            <Link href={href} key={href}>
              <Icon aria-hidden />
              <span className="studio-nav-text">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="studio-sidebar-foot">
        <Link href="/studio/releases/new" className="studio-quick">
          <Plus aria-hidden />
          New release
        </Link>
        <form action={signOut}>
          <button>
            <Logout aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
