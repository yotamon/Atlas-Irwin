"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { ArrowRightIcon } from "@/components/icons";

type CTAButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  ariaLabel?: string;
};

export function CTAButton({
  href,
  children,
  variant = "primary",
  className = "",
  ariaLabel,
}: CTAButtonProps) {
  if (variant === "secondary") {
    return (
      <motion.a
        href={href}
        aria-label={ariaLabel}
        whileHover={{ scale: 1.03, y: -1 }}
        whileTap={{ scale: 0.98 }}
        className={`group inline-flex items-end gap-3 text-left font-display text-[1.8rem] uppercase tracking-[0.17em] text-ink transition-colors duration-200 hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 sm:text-[2rem] ${className}`}
      >
        <span className="leading-[0.88]">{children}</span>
        <span className="mb-[0.18rem] inline-flex h-px w-12 origin-left bg-current transition-transform duration-200 group-hover:scale-x-125" />
      </motion.a>
    );
  }

  return (
    <motion.a
      href={href}
      aria-label={ariaLabel}
      whileHover={{
        scale: 1.03,
        boxShadow: "0 18px 30px rgba(182, 255, 59, 0.38)",
      }}
      whileTap={{ scale: 0.98 }}
      className={`group inline-flex min-h-[3.25rem] items-center gap-4 rounded-full border border-ink/70 bg-accent px-7 py-3 font-display text-[1.35rem] uppercase tracking-[0.12em] text-ink shadow-[0_6px_0_rgba(17,17,17,0.09)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 sm:min-h-[3.45rem] sm:px-8 sm:text-[1.45rem] ${className}`}
    >
      <span>{children}</span>
      <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 sm:h-5 sm:w-5" />
    </motion.a>
  );
}
