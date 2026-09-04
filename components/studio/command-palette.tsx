"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

type Command = {
  label: string;
  group: "Navigate" | "Create" | "Manage";
  keywords: string;
  href: string;
};

export function CommandPalette({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  function close() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ensemblis-command-trigger"
        aria-label="Search Ensemblis. Command or Control K"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      {open ? (
        <div className="ensemblis-command-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section className="ensemblis-command-dialog" role="dialog" aria-modal="true" aria-label="Search Ensemblis">
            <div className="ensemblis-command-search">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Ensemblis or choose an action…"
                aria-label="Search commands"
              />
              <button type="button" onClick={close} aria-label="Close search">Esc</button>
            </div>
            <div className="ensemblis-command-results">
              {(["Navigate", "Create", "Manage"] as const).map((group) => {
                const groupCommands = filtered.filter((command) => command.group === group);
                if (!groupCommands.length) return null;
                return (
                  <div className="ensemblis-command-group" key={group}>
                    <span>{group}</span>
                    {groupCommands.map((command) => (
                      <Link href={command.href} key={`${group}-${command.label}`} onClick={() => setOpen(false)}>
                        <strong>{command.label}</strong>
                        <small>{command.keywords.split(" ").slice(0, 3).join(" · ")}</small>
                        <b aria-hidden>↵</b>
                      </Link>
                    ))}
                  </div>
                );
              })}
              {!filtered.length ? <div className="ensemblis-command-empty">No matching workspace or action.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
