import Link from "next/link";
import Image from "next/image";
import { studioIcons } from "./icons";
import { signOut } from "@/app/studio/actions";
const links = [
  [/studio$/, "Dashboard", "dashboard"],
  [/studio\/releases/, "Releases", "releases"],
  [/studio\/content/, "Content Lab", "content"],
  [/studio\/calendar/, "Calendar", "calendar"],
  [/studio\/outreach/, "Outreach", "outreach"],
  [/studio\/analytics/, "Analytics", "analytics"],
  [/studio\/soundcloud/, "SoundCloud", "soundcloud"],
  [/studio\/spotify/, "Spotify", "spotify"],
  [/studio\/brand/, "Brand", "brand"],
] as const;
export function StudioSidebar() {
  const Plus = studioIcons.plus;
  const Logout = studioIcons.logout;
  return (
    <aside className="studio-sidebar">
      <Link href="/studio" className="studio-mark">
        <Image src="/atlas-irwin-logo-sign.svg" alt="" width={38} height={38} />
        <span>
          ATLAS<small>RELEASE ENGINE</small>
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
