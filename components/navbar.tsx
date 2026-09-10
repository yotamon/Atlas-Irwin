"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HiBars3, HiXMark } from "react-icons/hi2";
import { ThemeToggle } from "@/components/theme-toggle";

type NavLink = { href: string; id: string; label: string };

type NavbarProps = {
  artistName?: string;
  logoUrl?: string | null;
  links?: NavLink[];
};

const defaultLinks: NavLink[] = [
  { href: "#music", id: "music", label: "Music" },
  { href: "#platforms", id: "platforms", label: "Listen" },
  { href: "#about", id: "about", label: "About" },
  { href: "#contact", id: "contact", label: "Contact" },
];

export function Navbar({
  artistName = "Atlas Irwin",
  logoUrl = "/atlas-irwin-logo-sign.svg",
  links = defaultLinks,
}: NavbarProps = {}) {
  const prefersReducedMotion = useReducedMotion();
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const ids = links.map((link) => link.id);

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id);
        }
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin: "-20% 0px -60% 0px",
    });

    ids.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observerRef.current!.observe(element);
    });

    return () => observerRef.current?.disconnect();
  }, [links]);

  useEffect(() => {
    if (!menuOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const isActive = (id: string) => activeId === id;
  const focusVisible =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25";

  const renderLink = (
    href: string,
    id: string,
    label: string,
    variant: "desktop" | "mobile",
  ) => {
    const active = isActive(id);

    if (variant === "desktop") {
      return (
        <a
          href={href}
          aria-current={active ? "page" : undefined}
          className={`nav-underline relative leading-none transition-colors duration-200 ${
            active ? "text-teal" : "text-ink"
          } ${focusVisible}`}
        >
          {label}
          {active && (
            <span
              aria-hidden="true"
              className="absolute -bottom-1 left-0 h-0.5 w-full rounded-full bg-teal"
            />
          )}
        </a>
      );
    }

    return (
      <a
        href={href}
        onClick={closeMenu}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 font-display text-[2rem] font-semibold leading-none transition-colors duration-200 ${
          active ? "text-teal" : "text-ink"
        } ${focusVisible}`}
      >
        {active && (
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-teal"
          />
        )}
        {label}
      </a>
    );
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200 ${
        isScrolled
          ? "border-line bg-paper/90 shadow-[0_10px_24px_var(--shadow)] backdrop-blur-md"
          : "border-transparent bg-transparent"
      }`}
    >
      <a
        href="#main-content"
        className={`sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-60 focus:inline-flex focus:items-center focus:rounded-full focus:border-2 focus:border-teal focus:bg-paper focus:px-4 focus:py-2 focus:text-[0.85rem] focus:font-bold focus:uppercase focus:text-teal focus:shadow-lg ${focusVisible}`}
      >
        Skip to content
      </a>

      <div className="relative mx-auto flex min-h-[5.4rem] w-full items-center gap-4 px-5 sm:min-h-[6.8rem] sm:px-9 lg:px-9">
        <a
          href="#music"
          aria-label={`${artistName} — Home`}
          className={`inline-flex items-center rounded-full text-ink ${focusVisible}`}
        >
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt=""
              aria-hidden="true"
              width={88}
              height={48}
              priority
              loading="eager"
              className="theme-logo h-[2.65rem] w-auto sm:h-[2.85rem]"
            />
          ) : (
            <span className="font-display text-[1.25rem] uppercase tracking-[0.12em]">
              {artistName}
            </span>
          )}
        </a>

        <nav
          aria-label="Main navigation"
          className="ml-4 hidden items-center gap-10 justify-self-start font-sans text-[1.12rem] font-extrabold uppercase leading-none text-ink md:flex lg:ml-5 lg:gap-11 lg:text-[1.18rem]"
        >
          {links.map((link) => (
            <span key={link.id} className="relative">
              {renderLink(link.href, link.id, link.label, "desktop")}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 sm:gap-6">
          <AnimatePresence>
            {isScrolled && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, x: 12, scale: 0.94 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, x: 0, scale: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, x: 12, scale: 0.94 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="hidden md:block"
              >
                <ThemeToggle />
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((value) => !value)}
            className={`flex items-center justify-center rounded-md p-2 text-ink md:hidden ${focusVisible}`}
          >
            {menuOpen ? (
              <HiXMark className="h-7 w-7" />
            ) : (
              <HiBars3 className="h-7 w-7" />
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="mobile-menu"
            initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
            animate={prefersReducedMotion ? undefined : { height: "auto", opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-ink/10 bg-paper/90 backdrop-blur-xl md:hidden"
          >
            <nav
              aria-label="Mobile navigation"
              className="mx-auto flex flex-col gap-7 px-7 py-10 sm:px-9"
            >
              {links.map((link) => (
                <div key={link.id}>
                  {renderLink(link.href, link.id, link.label, "mobile")}
                </div>
              ))}
              <div className="mt-4 flex justify-start border-t border-line pt-6">
                <ThemeToggle />
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
