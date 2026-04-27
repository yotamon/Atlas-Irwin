"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { SoundMotionIcon } from "@/components/icons";

const links = [
  { href: "#music", label: "Music" },
  { href: "#visuals", label: "Visuals" },
  { href: "#about", label: "About" },
  { href: "#contact", label: "Contact" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200 ${
        isScrolled
          ? "border-line bg-paper/90 shadow-[0_10px_24px_var(--shadow)] backdrop-blur-md"
          : "border-ink/55 bg-paper/74 backdrop-blur-sm"
      }`}
    >
      <div className="relative mx-auto grid min-h-20 w-full max-w-[1600px] grid-cols-[auto_1fr_auto] items-center gap-4 px-5 sm:min-h-22 sm:px-8 lg:px-12">
        <a
          href="#music"
          aria-label="Atlas Irwin home"
          className="inline-flex items-center gap-3 rounded-full transition-transform duration-200 hover:scale-[1.02]"
        >
          <Image
            src="/atlas-irwin-logo-sign.svg"
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            loading="eager"
            className="theme-logo h-7 w-7 sm:h-7.5 sm:w-7.5"
          />
          <Image
            src="/atlas-irwin-logo-text-transparent.png"
            alt="Atlas Irwin"
            width={1080}
            height={185}
            priority
            loading="eager"
            unoptimized
            className="theme-logo h-auto w-[10.6rem] sm:w-[11.4rem]"
          />
        </a>

        <nav className="mx-auto hidden items-center gap-7 font-display text-[1.48rem] uppercase tracking-[0.18em] md:flex lg:gap-11 lg:text-[1.62rem]">
          {links.map((link) => (
            <a key={link.label} href={link.href} className="nav-underline leading-none">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="absolute right-5 top-1/2 flex -translate-y-1/2 items-center gap-3 sm:right-8 lg:right-12">
          <span className="hidden font-display text-[0.96rem] uppercase tracking-[0.25em] text-teal sm:block lg:text-[1.08rem]">
            Sound in Motion
          </span>
          <a
            href="#contact"
            aria-label="Contact Atlas Irwin"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-teal text-teal transition-transform duration-200 hover:scale-105 hover:bg-teal hover:text-paper"
          >
            <SoundMotionIcon className="h-9 w-9" />
          </a>
        </div>
      </div>

      <div className="border-t border-line/70 md:hidden">
        <nav className="mx-auto flex max-w-[1600px] items-center gap-5 overflow-x-auto px-5 py-3 font-display text-[1.12rem] uppercase tracking-[0.18em] text-ink/88 sm:px-8">
          {links.map((link) => (
            <a key={link.label} href={link.href} className="nav-underline shrink-0 leading-none">
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
