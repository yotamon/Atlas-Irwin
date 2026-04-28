"use client";

import { useState, useSyncExternalStore } from "react";
import { IoMoon, IoSunny } from "react-icons/io5";

type ThemeMode = "light" | "dark";

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("atlas-theme", theme);
}

export function ThemeToggle() {
  const [themeOverride, setThemeOverride] = useState<ThemeMode | null>(null);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const resolvedTheme = !isClient
    ? "light"
    : (themeOverride ??
      (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));

  const updateTheme = (nextTheme: ThemeMode) => {
    setThemeOverride(nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface-strong p-1 text-ink shadow-[0_8px_16px_var(--shadow)]">
      <button
        type="button"
        aria-label="Switch to light mode"
        aria-pressed={resolvedTheme === "light"}
        onClick={() => updateTheme("light")}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 ${
          resolvedTheme === "light"
            ? "border border-teal bg-paper text-teal"
            : "text-muted hover:text-ink"
        }`}
      >
        <IoSunny className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Switch to dark mode"
        aria-pressed={resolvedTheme === "dark"}
        onClick={() => updateTheme("dark")}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 ${
          resolvedTheme === "dark"
            ? "border border-teal bg-paper text-teal"
            : "text-muted hover:text-ink"
        }`}
      >
        <IoMoon className="h-5 w-5" />
      </button>
    </div>
  );
}
