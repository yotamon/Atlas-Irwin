"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

type Command = {
  label: string;
  group: "Navigate" | "Create" | "Manage";
  keywords: string;
  href: string;
};

type ObjectSearchResult = {
  id: string;
  type: string;
  label: string;
  detail: string;
  href: string;
};

export function CommandPalette({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [objectResults, setObjectResults] = useState<ObjectSearchResult[]>([]);
  const [searchingObjects, setSearchingObjects] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const commands = useMemo<Command[]>(() => [
    { label: "Today", group: "Navigate", keywords: "home next action needs you working", href: ensemblisArtistHref("/studio", artistId) },
    { label: "Music", group: "Navigate", keywords: "tracks vault intelligence stems lyrics", href: ensemblisArtistHref("/studio/music", artistId) },
    { label: "Releases", group: "Navigate", keywords: "catalog upcoming live release", href: ensemblisArtistHref("/studio/releases", artistId) },
    { label: "Create", group: "Navigate", keywords: "creative content generate", href: ensemblisArtistHref("/studio/create", artistId) },
    { label: "Grow", group: "Navigate", keywords: "growth performance opportunities campaigns", href: ensemblisArtistHref("/studio/growth", artistId) },
    { label: "Audience", group: "Navigate", keywords: "comments messages replies community", href: ensemblisArtistHref("/studio/audience", artistId) },
    { label: "Library", group: "Navigate", keywords: "media assets images video audio", href: ensemblisArtistHref("/studio/library", artistId) },
    { label: "New release", group: "Create", keywords: "release create add", href: ensemblisArtistHref("/studio/releases/new", artistId) },
    { label: "Generate music", group: "Create", keywords: "music lab ai track draft", href: ensemblisArtistHref("/studio/music?view=generate", artistId) },
    { label: "Video Director", group: "Create", keywords: "video music video motion", href: ensemblisArtistHref("/studio/video", artistId) },
    { label: "Campaigns", group: "Create", keywords: "campaign marketing content", href: ensemblisArtistHref("/studio/campaigns", artistId) },
    { label: "Distribution", group: "Manage", keywords: "dsp delivery stores", href: ensemblisArtistHref("/studio/distribution", artistId) },
    { label: "Connections", group: "Manage", keywords: "spotify instagram tiktok youtube accounts", href: ensemblisArtistHref("/studio/connections", artistId) },
    { label: "Settings", group: "Manage", keywords: "preferences ai brand", href: ensemblisArtistHref("/studio/settings", artistId) },
  ], [artistId]);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? commands.filter((command) => `${command.label} ${command.group} ${command.keywords}`.toLowerCase().includes(normalized))
    : commands;

  const close = useCallback(() => {
    setOpen(false);
    setObjectResults([]);
    setSearchingObjects(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openPalette = useCallback(() => {
    setQuery("");
    setObjectResults([]);
    setSearchingObjects(false);
    setOpen(true);
  }, []);

  const resultLinks = useCallback(() => {
    return Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-command-result]") ?? []);
  }, []);

  const focusResult = useCallback((target: "first" | "last" | "next" | "previous", current?: HTMLElement) => {
    const links = resultLinks();
    if (!links.length) return;
    if (target === "first") {
      links[0]?.focus();
      return;
    }
    if (target === "last") {
      links.at(-1)?.focus();
      return;
    }
    const currentIndex = current ? links.indexOf(current as HTMLAnchorElement) : -1;
    const nextIndex = target === "next"
      ? Math.min(links.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    links[nextIndex]?.focus();
  }, [resultLinks]);

  const onResultKeyDown = useCallback((event: ReactKeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusResult("next", event.currentTarget);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const links = resultLinks();
      if (links[0] === event.currentTarget) inputRef.current?.focus();
      else focusResult("previous", event.currentTarget);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusResult("first");
    } else if (event.key === "End") {
      event.preventDefault();
      focusResult("last");
    }
  }, [focusResult, resultLinks]);

  const onDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href]:not([aria-disabled="true"])',
    ) ?? []).filter((element) => element.tabIndex !== -1);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close();
        else openPalette();
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, openPalette]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), artist: artistId });
      void fetch(`/api/studio/search?${params.toString()}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ results?: ObjectSearchResult[] }> : null)
        .then((payload) => {
          if (!controller.signal.aborted) setObjectResults(payload?.results ?? []);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!controller.signal.aborted) setObjectResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingObjects(false);
        });
    }, 160);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [artistId, normalized, open, query]);

  function changeQuery(value: string) {
    setQuery(value);
    setObjectResults([]);
    setSearchingObjects(value.trim().length >= 2);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ensemblis-command-trigger"
        aria-label="Search Ensemblis. Command or Control K"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPalette}
      >
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      {open ? (
        <div className="ensemblis-command-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section
            ref={dialogRef}
            className="ensemblis-command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search Ensemblis"
            onKeyDown={onDialogKeyDown}
          >
            <div className="ensemblis-command-search">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusResult("first");
                  } else if (event.key === "End" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    focusResult("last");
                  }
                }}
                placeholder="Search tracks, releases, campaigns, content or actions…"
                aria-label="Search commands and artist objects"
                aria-controls="ensemblis-command-results"
              />
              <button type="button" onClick={close} aria-label="Close search">Esc</button>
            </div>
            <div className="ensemblis-command-results" id="ensemblis-command-results" ref={resultsRef}>
              {searchingObjects ? <div className="ensemblis-command-searching" role="status">Searching {"\u2026"}</div> : null}
              {objectResults.length ? (
                <div className="ensemblis-command-group ensemblis-command-object-results">
                  <span>Artist results</span>
                  {objectResults.map((result) => (
                    <Link data-command-result href={result.href} key={result.id} onClick={close} onKeyDown={onResultKeyDown}>
                      <strong>{result.label}</strong>
                      <small>{result.type} · {result.detail}</small>
                      <b aria-hidden>↵</b>
                    </Link>
                  ))}
                </div>
              ) : null}
              {(["Navigate", "Create", "Manage"] as const).map((group) => {
                const groupCommands = filtered.filter((command) => command.group === group);
                if (!groupCommands.length) return null;
                return (
                  <div className="ensemblis-command-group" key={group}>
                    <span>{group}</span>
                    {groupCommands.map((command) => (
                      <Link data-command-result href={command.href} key={`${group}-${command.label}`} onClick={close} onKeyDown={onResultKeyDown}>
                        <strong>{command.label}</strong>
                        <small>{command.keywords.split(" ").slice(0, 3).join(" · ")}</small>
                        <b aria-hidden>↵</b>
                      </Link>
                    ))}
                  </div>
                );
              })}
              {!searchingObjects && !objectResults.length && !filtered.length ? <div className="ensemblis-command-empty">No matching workspace, action or artist object.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
