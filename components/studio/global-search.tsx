"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export type SearchHit = {
  id: string;
  kind: "Release" | "Content" | "Contact" | "Asset" | "Task";
  title: string;
  meta: string;
  href: string;
};

export function GlobalSearch({ items }: { items: SearchHit[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return items
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.meta.toLowerCase().includes(q) ||
          item.kind.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        root.current?.querySelector("input")?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    function onClick(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  return (
    <div className="studio-search" ref={root}>
      <label>
        <span className="sr-only">Search studio</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search…"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls="studio-search-results"
        />
        <kbd>⌘K</kbd>
      </label>
      {open && query.trim() ? (
        <div className="studio-search-results" id="studio-search-results" role="listbox">
          {results.length ? (
            results.map((item) => (
              <Link
                key={`${item.kind}-${item.id}`}
                href={item.href}
                role="option"
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="search-kind">{item.kind}</span>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </Link>
            ))
          ) : (
            <p className="studio-search-empty">No matches for “{query.trim()}”</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
