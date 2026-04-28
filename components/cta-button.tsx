"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { FaArrowRight } from "react-icons/fa";

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
        whileHover={{ scale: 1.02, y: -1 }}
        whileTap={{ scale: 0.98 }}
        className={`group inline-flex items-center gap-3 text-left font-sans text-[1rem] font-extrabold uppercase leading-none text-ink transition-colors duration-200 hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 sm:text-[1.05rem] ${className}`}
      >
        <span>{children}</span>
      </motion.a>
    );
  }

  return (
    <motion.a
      href={href}
      aria-label={ariaLabel}
      whileHover={{
        scale: 1.02,
        boxShadow: "0 15px 24px rgba(182, 255, 59, 0.28)",
      }}
      whileTap={{ scale: 0.98 }}
      className={`group inline-flex min-h-[3.72rem] min-w-[18.65rem] items-center justify-between gap-5 rounded-full border-[1.5px] border-[#101010] bg-accent px-8 py-3 font-sans text-[1rem] font-extrabold uppercase leading-none text-[#101010] shadow-[0_2px_0_var(--shadow)] transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 sm:text-[1.05rem] ${className}`}
    >
      <span>{children}</span>
      <FaArrowRight className="h-8 w-8 transition-transform duration-200 group-hover:translate-x-1" />
    </motion.a>
  );
}
