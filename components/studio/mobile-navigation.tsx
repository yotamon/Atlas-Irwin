"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ArtistSwitcher } from "./artist-switcher";
import { Dialog } from "./dialog";
import { studioIcons } from "./icons";
import {
  ENSEMBLIS_CREATE_ACTION,
  ENSEMBLIS_MOBILE_MORE_NAV,
  ENSEMBLIS_MOBILE_WORK_NAV,
  ENSEMBLIS_SETTINGS_NAV,
  ensemblisArtistHref,
  resolveEnsemblisRouteContext,
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
  const context = resolveEnsemblisRouteContext(pathname);
  const [dialogState, setDialogState] = useState({ pathname, open: false });
  const open = dialogState.pathname === pathname && dialogState.open;
  const setOpen = (nextOpen: boolean) => setDialogState({ pathname, open: nextOpen });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const SettingsIcon = studioIcons[ENSEMBLIS_SETTINGS_NAV.icon];
  const CreateIcon = studioIcons[ENSEMBLIS_CREATE_ACTION.icon];
  const settingsActive = routeIsActive(pathname, ENSEMBLIS_SETTINGS_NAV.href)
    || context.parentHref === ENSEMBLIS_SETTINGS_NAV.href;
  const createActive = routeIsActive(pathname, ENSEMBLIS_CREATE_ACTION.href)
    || context.parentHref === ENSEMBLIS_CREATE_ACTION.href;
  const moreActive = ENSEMBLIS_MOBILE_MORE_NAV.some((item) => routeIsActive(pathname, item.href) || context.parentHref === item.href)
    || settingsActive
    || routeIsActive(pathname, "/studio/needs-you")
    || createActive;

  return (
    <nav className="ensemblis-mobile-navigation" aria-label="Ensemblis mobile navigation">
      {ENSEMBLIS_MOBILE_WORK_NAV.map((item) => {
        const Icon = studioIcons[item.icon];
        const active = routeIsActive(pathname, item.href) || context.parentHref === item.href;
        return (
          <Link
            href={ensemblisArtistHref(item.href, artistId)}
            key={item.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <Icon aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}

      <button
        ref={triggerRef}
        type="button"
        className={`ensemblis-mobile-more-trigger${moreActive ? " is-active" : ""}`}
        aria-label="Open more Ensemblis tools"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="ensemblis-mobile-more-icon" aria-hidden>•••</span>
        <span>More</span>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Workspace & tools"
        description="Create, decisions, utilities and settings without changing the primary navigation model."
        className="ensemblis-mobile-more-dialog"
        returnFocusRef={triggerRef}
      >
        <Link
          className={`button primary ensemblis-mobile-create${createActive ? " is-active" : ""}`}
          aria-current={createActive ? "page" : undefined}
          href={ensemblisArtistHref(ENSEMBLIS_CREATE_ACTION.href, artistId)}
          onClick={() => setOpen(false)}
        >
          <CreateIcon aria-hidden />
          <span>Create</span>
        </Link>

        <ArtistSwitcher activeArtistId={artistId} artists={artists} />

        <Link className="ensemblis-mobile-needs-you" href={ensemblisArtistHref("/studio/needs-you", artistId)} onClick={() => setOpen(false)}>
          <strong>Needs You</strong>
          <span>Decisions and approvals that require your judgment</span>
        </Link>

        <div className="ensemblis-mobile-more-links">
          {ENSEMBLIS_MOBILE_MORE_NAV.map((item) => {
            const Icon = studioIcons[item.icon];
            const active = routeIsActive(pathname, item.href) || context.parentHref === item.href;
            return (
              <Link
                href={ensemblisArtistHref(item.href, artistId)}
                key={item.href}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <Link
            href={ensemblisArtistHref(ENSEMBLIS_SETTINGS_NAV.href, artistId)}
            className={settingsActive ? "is-active" : undefined}
            aria-current={settingsActive ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <SettingsIcon aria-hidden />
            <span>{ENSEMBLIS_SETTINGS_NAV.label}</span>
          </Link>
        </div>
      </Dialog>
    </nav>
  );
}
