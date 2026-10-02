"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { emitStudioUxEvent } from "@/lib/studio/ux-telemetry-client";

type IntentResult = {
  id: string;
  resultType: "action" | "object" | "answer";
  label: string;
  detail: string;
  href: string;
  eyebrow?: string;
  primary?: boolean;
};

type IntentResponse = {
  intent?: {
    kind: string;
    confidence: "high" | "medium" | "low";
    source: "deterministic" | "semantic";
  } | null;
  results?: IntentResult[];
  usedSemanticFallback?: boolean;
};

type QuickAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type CommandPaletteSuggestion = {
  label: string;
  detail: string;
  href: string;
};

export function CommandPalette({
  artistId,
  variant = "compact",
  suggestions = [],
}: {
  artistId: string;
  variant?: "compact" | "launcher" | "mobile";
  suggestions?: CommandPaletteSuggestion[];
}) {
  const [open, setOpen] = useState(false);
  const launcher = variant === "launcher";
  const mobile = variant === "mobile";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntentResult[]>([]);
  const [resolving, setResolving] = useState(false);
  const [semanticResolving, setSemanticResolving] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [resolutionSource, setResolutionSource] = useState<"deterministic" | "semantic" | null>(null);
  const [resolvedIntentKind, setResolvedIntentKind] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const defaultQuickActions = useMemo<QuickAction[]>(() => [
    {
      id: "quick:add",
      label: "Add music",
      detail: "Bring in a mastered track or release.",
      href: ensemblisArtistHref("/studio/music?view=add", artistId),
    },
    {
      id: "quick:mix",
      label: "Make a DJ mix",
      detail: "Choose music, shape the set and render.",
      href: ensemblisArtistHref("/studio/music/automix", artistId),
    },
    {
      id: "quick:release",
      label: "Prepare a release",
      detail: "Start a release and keep the next steps together.",
      href: ensemblisArtistHref("/studio/releases/new", artistId),
    },
    {
      id: "quick:create",
      label: "Create from my music",
      detail: "Start from the strongest musical source.",
      href: ensemblisArtistHref("/studio/create", artistId),
    },
    {
      id: "quick:connect",
      label: "Connect my music library",
      detail: "Use local music without uploading it.",
      href: ensemblisArtistHref("/studio/connect-library-bridge", artistId),
    },
  ], [artistId]);
  const quickActions: QuickAction[] = suggestions.length
    ? suggestions.slice(0, 4).map((suggestion, index) => ({ ...suggestion, id: `context:${index}:${suggestion.href}` }))
    : defaultQuickActions;

  const normalized = query.trim();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setResolving(false);
    setSemanticResolving(false);
    setSearchError("");
    setResolutionSource(null);
    setResolvedIntentKind(null);
  }, []);

  const openPalette = useCallback(() => {
    emitStudioUxEvent({ event: "launcher_opened", source: variant });
    setQuery("");
    setResults([]);
    setResolving(false);
    setSemanticResolving(false);
    setSearchError("");
    setResolutionSource(null);
    setResolvedIntentKind(null);
    setOpen(true);
  }, [variant]);

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
    let semanticTimer: number | undefined;

    const deterministicTimer = window.setTimeout(() => {
      setResolving(true);
      setSearchError("");
      const params = new URLSearchParams({ q: normalized, artist: artistId, semantic: "0" });
      void fetch(`/api/studio/intent?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Ensemblis could not understand that request right now.");
          return response.json() as Promise<IntentResponse>;
        })
        .then((payload) => {
          if (controller.signal.aborted) return;
          const nextResults = payload.results ?? [];
          setResults(nextResults);
          setResolutionSource(payload.intent?.source ?? null);
          setResolvedIntentKind(payload.intent?.kind ?? null);
          emitStudioUxEvent({
            event: "launcher_resolution",
            source: nextResults.length ? "matched" : "no_match",
            intentKind: payload.intent?.kind ?? null,
            resolutionSource: payload.intent?.source ?? null,
            resultType: nextResults[0]?.resultType ?? null,
          });
          setResolving(false);

          const wordCount = normalized.split(/\s+/).filter(Boolean).length;
          const shouldTrySemantic = wordCount >= 3
            && (nextResults.length === 0 || payload.intent?.confidence === "low");

          if (!shouldTrySemantic) return;

          semanticTimer = window.setTimeout(() => {
            setSemanticResolving(true);
            const semanticParams = new URLSearchParams({ q: normalized, artist: artistId, semantic: "1" });
            void fetch(`/api/studio/intent?${semanticParams.toString()}`, { signal: controller.signal })
              .then(async (response) => {
                if (!response.ok) return null;
                return response.json() as Promise<IntentResponse>;
              })
              .then((semanticPayload) => {
                if (controller.signal.aborted || !semanticPayload) return;
                const semanticResults = semanticPayload.results ?? [];
                if (semanticResults.length) {
                  const source = semanticPayload.usedSemanticFallback ? "semantic" : semanticPayload.intent?.source ?? null;
                  setResults(semanticResults);
                  setResolutionSource(source);
                  setResolvedIntentKind(semanticPayload.intent?.kind ?? null);
                  emitStudioUxEvent({
                    event: "launcher_resolution",
                    source: "semantic_match",
                    intentKind: semanticPayload.intent?.kind ?? null,
                    resolutionSource: source,
                    resultType: semanticResults[0]?.resultType ?? null,
                  });
                }
              })
              .finally(() => {
                if (!controller.signal.aborted) setSemanticResolving(false);
              });
          }, 520);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setResults([]);
            setResolving(false);
            setSearchError(error instanceof Error ? error.message : "Ensemblis could not understand that request right now.");
          }
        });
    }, 160);

    return () => {
      controller.abort();
      window.clearTimeout(deterministicTimer);
      if (semanticTimer !== undefined) window.clearTimeout(semanticTimer);
    };
  }, [artistId, normalized, open, retryKey]);

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setResults([]);
    setSearchError("");
    setResolutionSource(null);
    setResolvedIntentKind(null);
    setResolving(nextQuery.trim().length >= 2);
    setSemanticResolving(false);
  }

  const visibleQuickActions = launcher || mobile ? quickActions.slice(0, 4) : quickActions;

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
              <strong>Tell Ensemblis in your own words…</strong>
            </span>
            <kbd>⌘/Ctrl K</kbd>
          </>
        ) : mobile ? (
          <>
            <span className="ensemblis-mobile-search-icon" aria-hidden>⌕</span>
            <span>Ask</span>
          </>
        ) : (
          <>
            <span>Ask or search</span>
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
                  placeholder="Try “master Love Like This” or “how is my latest release doing?”"
                  aria-label="Tell Ensemblis what you want to do"
                  aria-controls="ensemblis-command-results"
                  autoComplete="off"
                />
                <BaseDialog.Close type="button" aria-label="Close search">Esc</BaseDialog.Close>
              </div>

              <div className="ensemblis-command-results" id="ensemblis-command-results" ref={resultsRef}>
                {!normalized ? (
                  <div className="ensemblis-command-group ensemblis-command-quick">
                    <span>Start with a goal</span>
                    {visibleQuickActions.map((action) => (
                      <Link
                        data-command-result
                        href={action.href}
                        key={action.id}
                        onClick={() => {
                          emitStudioUxEvent({ event: "launcher_action", source: "quick_action", resultType: "action" });
                          close();
                        }}
                        onKeyDown={onResultKeyDown}
                      >
                        <strong>{action.label}</strong>
                        <small>{action.detail}</small>
                        <b aria-hidden>↵</b>
                      </Link>
                    ))}
                  </div>
                ) : null}

                {resolving ? <div className="ensemblis-command-searching" role="status">Finding the right action…</div> : null}
                {!resolving && semanticResolving ? <div className="ensemblis-command-searching" role="status">Understanding the request…</div> : null}

                {searchError ? (
                  <div className="ensemblis-command-error" role="alert">
                    <span>{searchError}</span>
                    <button type="button" className="text-button" onClick={() => {
                      setResolving(true);
                      setRetryKey((value) => value + 1);
                    }}>Retry</button>
                  </div>
                ) : null}

                {normalized && results.length ? (
                  <div className="ensemblis-command-group ensemblis-intent-results">
                    <span>{resolutionSource === "semantic" ? "Ensemblis understood" : "Best match"}</span>
                    {results.map((result, index) => (
                      <Link
                        data-command-result
                        href={result.href}
                        key={result.id}
                        className={result.primary || index === 0 ? "is-primary-intent" : undefined}
                        onClick={() => {
                          emitStudioUxEvent({
                            event: "launcher_action",
                            source: "resolved_intent",
                            intentKind: resolvedIntentKind,
                            resultType: result.resultType,
                            resolutionSource,
                          });
                          close();
                        }}
                        onKeyDown={onResultKeyDown}
                      >
                        <span className="ensemblis-command-result-copy">
                          {result.eyebrow ? <em>{result.eyebrow}</em> : null}
                          <strong>{result.label}</strong>
                          <small>{result.detail}</small>
                        </span>
                        <b aria-hidden>↵</b>
                      </Link>
                    ))}
                  </div>
                ) : null}

                {normalized && !resolving && !semanticResolving && !searchError && !results.length ? (
                  <div className="ensemblis-command-empty">
                    <strong>I couldn&apos;t find a confident match.</strong>
                    <span>Try naming the track, release or goal more directly.</span>
                  </div>
                ) : null}
              </div>
            </BaseDialog.Popup>
          </BaseDialog.Viewport>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </>
  );
}
