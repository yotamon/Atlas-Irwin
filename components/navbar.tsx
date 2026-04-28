"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const links = [
  { href: "#music", label: "Music" },
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
          : "border-transparent bg-transparent"
      }`}
    >
      <div className="relative mx-auto flex min-h-[5.4rem] w-full items-center gap-4 px-5 sm:min-h-[6.8rem] sm:px-9 lg:px-9">
        <a
          href="#music"
          aria-label="Atlas Irwin home"
          className="inline-flex items-center rounded-full text-ink transition-transform duration-200 hover:scale-[1.02]"
        >
          <Image
            src="/atlas-irwin-logo-sign.svg"
            alt=""
            aria-hidden="true"
            width={88}
            height={48}
            priority
            loading="eager"
            className="theme-logo h-[2.65rem] w-auto sm:h-[2.85rem]"
          />
        </a>

        <nav className="ml-4 hidden items-center gap-10 justify-self-start font-sans text-[1.12rem] font-extrabold uppercase leading-none text-ink md:flex lg:ml-5 lg:gap-11 lg:text-[1.18rem]">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="nav-underline leading-none"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="border-t border-ink/10 bg-paper/55 backdrop-blur-sm md:hidden">
        <nav className="mx-auto flex items-center gap-5 overflow-x-auto px-5 py-3 font-sans text-[0.9rem] font-extrabold uppercase leading-none text-ink sm:px-8">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="nav-underline shrink-0 leading-none"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
