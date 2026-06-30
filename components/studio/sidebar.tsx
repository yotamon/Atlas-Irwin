import Link from "next/link";
import { studioIcons } from "./icons";
import { signOut } from "@/app/studio/actions";

const links = [
  [/studio$/, "Now", "dashboard"],
  [/studio\/releases/, "Catalog", "releases"],
  [/studio\/content/, "Content", "content"],
  [/studio\/calendar/, "Calendar", "calendar"],
  [/studio\/outreach/, "Outreach", "outreach"],
  [/studio\/analytics/, "Insights", "analytics"],
  [/studio\/soundcloud/, "Connections", "soundcloud"],
  [/studio\/spotify/, "Spotify", "spotify"],
  [/studio\/brand/, "Brand / Website", "brand"],
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
        {links.map(([, label, key]) => {
          const Icon = studioIcons[key];
          const href = key === "dashboard" ? "/studio" : `/studio/${key}`;
          return (
            <Link href={href} key={key}>
              <Icon aria-hidden />
              {label}
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
