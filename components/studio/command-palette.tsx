"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

type Command = {
  label: string;
  group: "Do" | "Go to" | "Create" | "Tools";
  keywords: string;
  description: string;
  href: string;
};

const INTENT_STOP_WORDS = new Set(["i", "me", "my", "want", "to", "a", "an", "the", "please", "can", "you", "help", "with"]);

function commandMatches(command: Command, query: string) {
  const haystack = `${command.label} ${command.group} ${command.keywords} ${command.description}`.toLowerCase();
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !INTENT_STOP_WORDS.has(token));
  return tokens.length ? tokens.every((token) => haystack.includes(token)) : haystack.includes(query.toLowerCase());
}

type ObjectSearchResult = {
  id: string;
  type: string;
  label: string;
  detail: string;
  href: string;
};

export function CommandPalette({
  artistId,
  variant = "compact",
}: {
  artistId: string;
  variant?: "compact" | "launcher" | "mobile";
}) {
  const [open, setOpen] = useState(false);
  const launcher = variant === "launcher";
  const mobile = variant === "mobile";
  const [query, setQuery] = useState("");
  const [objectResults, setObjectResults] = useState<ObjectSearchResult[]>([]);
  const [searchingObjects, setSearchingObjects] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const commands = useMemo<Command[]>(() => [
    { label: "Make a DJ mix", group: "Do", keywords: "automix auto mix dj set mix tracks rekordbox local library", description: "Choose music, shape the set, review transitions and render.", href: ensemblisArtistHref("/studio/music/automix", artistId) },
    { label: "Add music", group: "Do", keywords: "upload import master track song audio", description: "Bring a mastered track or release into Music.", href: ensemblisArtistHref("/studio/music?view=add", artistId) },
    { label: "Connect my music library", group: "Do", keywords: "computer desktop rekordbox local folder library bridge pair", description: "Pair this computer and use local music without uploading it.", href: ensemblisArtistHref("/studio/connect-library-bridge", artistId) },
    { label: "Prepare a release", group: "Do", keywords: "new release distribute distribution release mission", description: "Start a release and keep its music, creative and distribution together.", href: ensemblisArtistHref("/studio/releases/new", artistId) },
    { label: "Create from my music", group: "Do", keywords: "create content asset video artwork social moment", description: "Start from the strongest musical source and choose an outcome.", href: ensemblisArtistHref("/studio/create", artistId) },
    { label: "Today", group: "Go to", keywords: "home next action needs you working", description: "Start, continue or decide.", href: ensemblisArtistHref("/studio", artistId) },
    { label: "Music", group: "Go to", keywords: "tracks releases mixes vault intelligence stems lyrics", description: "Tracks, releases and mixes.", href: ensemblisArtistHref("/studio/music", artistId) },
    { label: "Releases", group: "Go to", keywords: "catalog upcoming live release", description: "Open release Missions.", href: ensemblisArtistHref("/studio/releases", artistId) },
    { label: "Grow", group: "Go to", keywords: "growth performance opportunities campaigns audience", description: "Opportunities, audience and performance.", href: ensemblisArtistHref("/studio/growth", artistId) },
    { label: "Library", group: "Go to", keywords: "media assets images video audio", description: "Reusable media assets.", href: ensemblisArtistHref("/studio/library", artistId) },
    { label: "Sites", group: "Go to", keywords: "website domains pages smart links", description: "Owned artist destinations.", href: ensemblisArtistHref("/studio/sites", artistId) },
    { label: "Create", group: "Create", keywords: "creative content generate", description: "Choose a deliverable from musical context.", href: ensemblisArtistHref("/studio/create", artistId) },
    { label: "New release", group: "Create", keywords: "release create add", description: "Create a new release Mission.", href: ensemblisArtistHref("/studio/releases/new", artistId) },
    { label: "Generate music", group: "Create", keywords: "music lab ai track draft", description: "Create a music draft when the artist allows AI music.", href: ensemblisArtistHref("/studio/music?view=generate", artistId) },
    { label: "Video Director", group: "Create", keywords: "video music video motion", description: "Direct a longer-form music video.", href: ensemblisArtistHref("/studio/video", artistId) },
    { label: "Campaigns", group: "Tools", keywords: "campaign marketing content growth", description: "Inspect specialist campaign work.", href: ensemblisArtistHref("/studio/campaigns", artistId) },
    { label: "Audience", group: "Tools", keywords: "comments messages replies community growth", description: "Inspect audience relationships.", href: ensemblisArtistHref("/studio/audience", artistId) },
    { label: "Distribution", group: "Tools", keywords: "dsp delivery stores releases", description: "Inspect distribution operations.", href: ensemblisArtistHref("/studio/distribution", artistId) },
    { label: "Connections", group: "Tools", keywords: "spotify instagram tiktok youtube accounts settings", description: "Manage connected services.", href: ensemblisArtistHref("/studio/connections", artistId) },
    { label: "Settings", group: "Tools", keywords: "preferences ai brand", description: "Artist and workspace preferences.", href: ensemblisArtistHref("/studio/settings", artistId) },
  ], [artistId]);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? commands.filter((command) => commandMatches(command, normalized))
    : commands;
  const visibleGroups: ReadonlyArray<Command["group"]> = !normalized && (launcher || mobile)
    ? ["Do"]
    : ["Do", "Go to", "Create", "Tools"];

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
        className={launcher ? "ensemblis-action-launcher-trigger" : mobile ? "ensemblis-command-mobile-trigger" : "ensemblis-command-trigger"}
        aria-label={launcher ? "Tell Ensemblis what you want to do" : "Search Ensemblis. Command or Control K"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPalette}
      >
        {launcher ? (
          <>
            <span className="ensemblis-action-launcher-copy">
              <small>What do you want to do?</small>
              <strong>Search or tell Ensemblis what you need…</strong>
            </span>
            <kbd>⌘/Ctrl K</kbd>
          </>
        ) : mobile ? (
          <>
            <span className="ensemblis-mobile-search-icon" aria-hidden>⌕</span>
            <span>Search</span>
          </>
        ) : (
          <>
            <span>Search</span>
            <kbd>⌘/Ctrl K</kbd>
          </>
        )}
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
              <BaseDialog.Title className="sr-only">What do you want to do in Ensemblis?</BaseDialog.Title>
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
                  placeholder="Try “make a DJ mix”, “add music”, or search for a track…"
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
                {visibleGroups.map((group) => {
                  const groupCommands = filtered.filter((command) => command.group === group);
                  if (!groupCommands.length) return null;
                  return (
                    <div className="ensemblis-command-group" key={group}>
                      <span>{group}</span>
                      {groupCommands.map((command) => (
                        <Link data-command-result href={command.href} key={`${group}-${command.label}`} onClick={close} onKeyDown={onResultKeyDown}>
                          <strong>{command.label}</strong>
                          <small>{command.description}</small>
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
