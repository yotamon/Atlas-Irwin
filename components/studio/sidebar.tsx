"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/studio/actions";
import { GlobalSearch, type SearchHit } from "./global-search";
import { studioIcons } from "./icons";

const groups = [
  {
    label: "Operate",
    links: [
      ["/studio", "Command", "dashboard"],
      ["/studio/releases", "Releases", "releases"],
      ["/studio/campaigns", "Campaigns", "campaigns"],
      ["/studio/tasks", "Tasks", "tasks"],
    ],
  },
  {
    label: "Create",
    links: [
      ["/studio/content", "Content", "content"],
      ["/studio/media", "Media", "media"],
      ["/studio/brand", "Brand", "brand"],
    ],
  },
  {
    label: "Connect",
    links: [
      ["/studio/outreach", "Outreach", "outreach"],
      ["/studio/spotify", "Spotify", "spotify"],
      ["/studio/soundcloud", "SoundCloud", "soundcloud"],
    ],
  },
  {
    label: "Measure",
    links: [
      ["/studio/analytics", "Analytics", "analytics"],
      ["/studio/data-health", "Data Health", "dataHealth"],
    ],
  },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/studio") return pathname === "/studio";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StudioSidebar({ searchItems }: { searchItems: SearchHit[] }) {
  const pathname = usePathname();
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;

  return (
    <aside className="studio-sidebar">
      <Link href="/studio" className="studio-mark">
        <span>
          ATLAS<small>STUDIO</small>
        </span>
      </Link>
      <div className="studio-sidebar-search">
        <GlobalSearch items={searchItems} />
      </div>
      <nav aria-label="Studio">
        {groups.map((group) => (
          <div className="studio-nav-group" key={group.label}>
            <span className="studio-nav-label">{group.label}</span>
            {group.links.map(([href, label, key]) => {
              const Icon = studioIcons[key];
              const active = isActive(pathname, href);
              return (
                <Link
                  href={href}
                  key={key}
                  className={active ? "active" : undefined}
                  aria-current={active ? "page" : undefined}
                  title={label}
                >
                  <Icon aria-hidden />
                  <span className="studio-nav-text">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="studio-sidebar-foot">
        <Link href="/studio/releases/new" className="studio-quick" title="Quick create">
          <Plus />
          <span className="studio-nav-text">Quick create</span>
        </Link>
        <form action={signOut}>
          <button type="submit" title="Sign out">
            <Logout />
            <span className="studio-nav-text">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
