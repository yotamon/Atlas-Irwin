"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { studioIcons } from "./icons";
import {
  ENSEMBLIS_PRIMARY_NAV,
  ensemblisArtistHref,
} from "@/lib/ensemblis-product";

function routeIsActive(pathname: string, href: string) {
  if (href === "/studio") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StudioPrimaryNavigation({ artistId }: { artistId: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Ensemblis primary navigation">
      {ENSEMBLIS_PRIMARY_NAV.map(({ href, label, icon }) => {
        const Icon = studioIcons[icon];
        const active = routeIsActive(pathname, href);
        return (
          <Link
            href={ensemblisArtistHref(href, artistId)}
            key={href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden />
            <span className="studio-nav-text">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function StudioAdvancedNavigation({ artistId }: { artistId: string }) {
  const pathname = usePathname();
  const href = "/studio/distribution";
  const active = routeIsActive(pathname, href);
  const Distribution = studioIcons.distribution;

  return (
    <Link
      href={ensemblisArtistHref(href, artistId)}
      className={active ? "is-active" : undefined}
      aria-current={active ? "page" : undefined}
    >
      <Distribution aria-hidden />
      <span className="studio-nav-text">Distribution</span>
    </Link>
  );
}
