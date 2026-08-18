import Link from "next/link";
import { studioIcons } from "./icons";
import { signOut } from "@/app/studio/actions";

const links = [
  ["/studio", "Command Center", "dashboard"],
  ["/studio/releases", "Releases", "releases"],
  ["/studio/music", "Music Lab", "musicLab"],
  ["/studio/campaigns", "Campaign Brain", "campaigns"],
  ["/studio/content", "Content Lab", "content"],
  ["/studio/outreach", "Outreach", "outreach"],
  ["/studio/media", "Media Library", "media"],
  ["/studio/analytics", "Analytics", "analytics"],
  ["/studio/data-health", "Data Health", "dataHealth"],
  ["/studio/brand", "Brand / Creative", "brand"],
] as const;

export function StudioSidebar() {
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;
  return (
    <aside className="studio-sidebar">
      <Link href="/studio" className="studio-mark">
        <span>
          ATLAS<small>STUDIO</small>
        </span>
      </Link>
      <nav>
        {links.map(([href, label, key]) => {
          const Icon = studioIcons[key];
          return (
            <Link href={href} key={key}>
              <Icon aria-hidden />
              <span className="studio-nav-text">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="studio-sidebar-foot">
        <Link href="/studio/releases/new" className="studio-quick">
          <Plus />
          Quick create
        </Link>
        <form action={signOut}>
          <button>
            <Logout />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
