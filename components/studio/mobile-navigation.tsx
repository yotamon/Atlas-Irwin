"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArtistSwitcher } from "./artist-switcher";
import { studioIcons } from "./icons";
import {
  ENSEMBLIS_MOBILE_MORE_NAV,
  ENSEMBLIS_MOBILE_WORK_NAV,
  ENSEMBLIS_SETTINGS_NAV,
  ensemblisArtistHref,
} from "@/lib/ensemblis-product";

type StudioMobileNavigationProps = {
  artistId: string;
  artists: Array<{
    artistId: string;
    artistName: string;
    workspaceName: string;
  }>;
};

function routeIsActive(pathname: string, route: string) {
  if (route === "/studio") return pathname === route;
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function StudioMobileNavigation({ artistId, artists }: StudioMobileNavigationProps) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const SettingsIcon = studioIcons[ENSEMBLIS_SETTINGS_NAV.icon];
  const moreActive = ENSEMBLIS_MOBILE_MORE_NAV.some((item) => routeIsActive(pathname, item.href))
    || routeIsActive(pathname, ENSEMBLIS_SETTINGS_NAV.href)
    || routeIsActive(pathname, "/studio/needs-you")
    || routeIsActive(pathname, "/studio/inbox");

  function closeMenu() {
    detailsRef.current?.removeAttribute("open");
  }

  useEffect(() => {
    detailsRef.current?.removeAttribute("open");
  }, [pathname]);

  return (
    <nav className="ensemblis-mobile-navigation" aria-label="Ensemblis mobile navigation">
      {ENSEMBLIS_MOBILE_WORK_NAV.map((item) => {
        const Icon = studioIcons[item.icon];
        const active = routeIsActive(pathname, item.href);
        return (
          <Link
            href={ensemblisArtistHref(item.href, artistId)}
            key={item.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
            onClick={closeMenu}
          >
            <Icon aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}

      <details className={`ensemblis-mobile-more${moreActive ? " is-active" : ""}`} ref={detailsRef}>
        <summary aria-label="More Ensemblis areas">
          <span className="ensemblis-mobile-more-icon" aria-hidden>•••</span>
          <span>More</span>
        </summary>
        <div className="ensemblis-mobile-more-sheet">
          <div className="ensemblis-mobile-sheet-heading">
            <div><span>More</span><strong>Workspace & tools</strong></div>
            <small>Growth, relationships and management stay one tap away.</small>
          </div>

          <ArtistSwitcher activeArtistId={artistId} artists={artists} />

          <Link className="ensemblis-mobile-needs-you" href={ensemblisArtistHref("/studio/needs-you", artistId)} onClick={closeMenu}>
            <strong>Needs You</strong>
            <span>Decisions and approvals that require your judgment</span>
          </Link>

          <div className="ensemblis-mobile-more-links">
            {ENSEMBLIS_MOBILE_MORE_NAV.map((item) => {
              const Icon = studioIcons[item.icon];
              const active = routeIsActive(pathname, item.href);
              return (
                <Link
                  href={ensemblisArtistHref(item.href, artistId)}
                  key={item.href}
                  className={active ? "is-active" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={closeMenu}
                >
                  <Icon aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <Link
              href={ensemblisArtistHref(ENSEMBLIS_SETTINGS_NAV.href, artistId)}
              className={routeIsActive(pathname, ENSEMBLIS_SETTINGS_NAV.href) ? "is-active" : undefined}
              aria-current={routeIsActive(pathname, ENSEMBLIS_SETTINGS_NAV.href) ? "page" : undefined}
              onClick={closeMenu}
            >
              <SettingsIcon aria-hidden />
              <span>{ENSEMBLIS_SETTINGS_NAV.label}</span>
            </Link>
          </div>
        </div>
      </details>
    </nav>
  );
}
