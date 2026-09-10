"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

type Command = {
  label: string;
  group: "Go to" | "Create" | "Tools";
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
  const [searchError, setSearchError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const commands = useMemo<Command[]>(() => [
    { label: "Today", group: "Go to", keywords: "home next action needs you working", href: ensemblisArtistHref("/studio", artistId) },
    { label: "Music", group: "Go to", keywords: "tracks vault intelligence stems lyrics", href: ensemblisArtistHref("/studio/music", artistId) },
    { label: "Releases", group: "Go to", keywords: "catalog upcoming live release", href: ensemblisArtistHref("/studio/releases", artistId) },
    { label: "Grow", group: "Go to", keywords: "growth performance opportunities campaigns audience", href: ensemblisArtistHref("/studio/growth", artistId) },
    { label: "Library", group: "Go to", keywords: "media assets images video audio", href: ensemblisArtistHref("/studio/library", artistId) },
    { label: "Sites", group: "Go to", keywords: "website domains pages", href: ensemblisArtistHref("/studio/sites", artistId) },
    { label: "Create", group: "Create", keywords: "creative content generate", href: ensemblisArtistHref("/studio/create", artistId) },
    { label: "New release", group: "Create", keywords: "release create add", href: ensemblisArtistHref("/studio/releases/new", artistId) },
    { label: "Generate music", group: "Create", keywords: "music lab ai track draft", href: ensemblisArtistHref("/studio/music?view=generate", artistId) },
    { label: "Video Director", group: "Create", keywords: "video music video motion", href: ensemblisArtistHref("/studio/video", artistId) },
    { label: "Campaigns", group: "Tools", keywords: "campaign marketing content growth", href: ensemblisArtistHref("/studio/campaigns", artistId) },
    { label: "Audience", group: "Tools", keywords: "comments messages replies community growth", href: ensemblisArtistHref("/studio/audience", artistId) },
    { label: "Distribution", group: "Tools", keywords: "dsp delivery stores releases", href: ensemblisArtistHref("/studio/distribution", artistId) },
    { label: "Connections", group: "Tools", keywords: "spotify instagram tiktok youtube accounts settings", href: ensemblisArtistHref("/studio/connections", artistId) },
    { label: "Settings", group: "Tools", keywords: "preferences ai brand", href: ensemblisArtistHref("/studio/settings", artistId) },
  ], [artistId]);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? commands.filter((command) => `${command.label} ${command.group} ${command.keywords}`.toLowerCase().includes(normalized))
    : commands;

  const close = useCallback(() => {
    setOpen(false);
    setObjectResults([]);
    setSearchingObjects(false);
    setSearchError("");
  }, []);

  const openPalette = useCallback(() => {
    setQuery("");
    setObjectResults([]);
    setSearchingObjects(false);
    setSearchError("");
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, openPalette]);

  useEffect(() => {
    if (!open || normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchError("");
      const params = new URLSearchParams({ q: query.trim(), artist: artistId });
      void fetch(`/api/studio/search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Search is temporarily unavailable.");
          return response.json() as Promise<{ results?: ObjectSearchResult[] }>;
        })
        .then((payload) => {
          if (!controller.signal.aborted) setObjectResults(payload.results ?? []);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setObjectResults([]);
            setSearchError(error instanceof Error ? error.message : "Search is temporarily unavailable.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingObjects(false);
        });
    }, 160);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [artistId, normalized, open, query, retryKey]);

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setObjectResults([]);
    setSearchError("");
    setSearchingObjects(nextQuery.trim().length >= 2);
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
        <kbd>⌘/Ctrl K</kbd>
      </button>

      <BaseDialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
      >
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="ensemblis-command-backdrop" />
          <BaseDialog.Viewport className="ensemblis-command-viewport">
            <BaseDialog.Popup
              className="ensemblis-command-dialog"
              initialFocus={inputRef}
              finalFocus={triggerRef}
            >
              <BaseDialog.Title className="sr-only">Search Ensemblis</BaseDialog.Title>
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
                <BaseDialog.Close type="button" aria-label="Close search">Esc</BaseDialog.Close>
              </div>
              <div className="ensemblis-command-results" id="ensemblis-command-results" ref={resultsRef}>
                {searchingObjects ? <div className="ensemblis-command-searching" role="status">Searching…</div> : null}
                {searchError ? (
                  <div className="ensemblis-command-error" role="alert">
                    <span>{searchError}</span>
                    <button type="button" className="text-button" onClick={() => {
                      setSearchingObjects(true);
                      setRetryKey((value) => value + 1);
                    }}>Retry</button>
                  </div>
                ) : null}
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
                {(["Go to", "Create", "Tools"] as const).map((group) => {
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
                {!searchingObjects && !searchError && !objectResults.length && !filtered.length ? <div className="ensemblis-command-empty">No matching workspace, action or artist object.</div> : null}
              </div>
            </BaseDialog.Popup>
          </BaseDialog.Viewport>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </>
  );
}
