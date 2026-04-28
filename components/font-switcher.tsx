"use client";

import { useState, useEffect } from "react";

const fonts = [
  "Bebas Neue",
  "cafeta",
  "cinematografica",
  "godger",
  "heading",
  "montage_2",
  "sex_face",
  "stacked_strong",
  "steelfish",
  "tt_bluescreens",
];

export function FontSwitcher() {
  const [currentFont, setCurrentFont] = useState("Bebas Neue");

  useEffect(() => {
    if (currentFont === "Bebas Neue") {
      document.documentElement.style.removeProperty("--font-heading");
    } else {
      document.documentElement.style.setProperty(
        "--font-heading",
        `"${currentFont}", sans-serif`,
      );
    }
  }, [currentFont]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 9999,
        background: "var(--surface-strong)",
        padding: "10px",
        borderRadius: "8px",
        border: "1px solid var(--line)",
      }}
    >
      <label
        htmlFor="font-switcher"
        style={{
          marginRight: "10px",
          fontSize: "14px",
          fontWeight: "bold",
        }}
      >
        Heading Font:
      </label>
      <select
        id="font-switcher"
        value={currentFont}
        onChange={(e) => setCurrentFont(e.target.value)}
        style={{
          background: "var(--paper)",
          color: "var(--ink)",
          padding: "4px 8px",
          borderRadius: "4px",
          border: "1px solid var(--line)",
        }}
      >
        {fonts.map((font) => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
      </select>
    </div>
  );
}
