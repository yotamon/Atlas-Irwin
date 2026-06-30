"use client";

import { useSyncExternalStore } from "react";

const themeInitScript = `
(() => {
  try {
    const storedTheme = localStorage.getItem("atlas-theme");
    const resolvedTheme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

const subscribe = () => () => {};

export function ThemeInitScript() {
  const shouldRender = useSyncExternalStore(
    subscribe,
    () => false,
    () => true,
  );

  if (!shouldRender) {
    return null;
  }

  return (
    <script
      id="atlas-theme-init"
      dangerouslySetInnerHTML={{ __html: themeInitScript }}
    />
  );
}
