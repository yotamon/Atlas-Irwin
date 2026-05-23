"use client";

import { useEffect } from "react";

function scrollToCurrentHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const target = document.getElementById(decodeURIComponent(hash));
  target?.scrollIntoView({ block: "start" });
}

export function HashScrollRestorer() {
  useEffect(() => {
    const timeouts = [80, 260, 700].map((delay) =>
      window.setTimeout(scrollToCurrentHash, delay),
    );
    const frame = window.requestAnimationFrame(scrollToCurrentHash);

    window.addEventListener("hashchange", scrollToCurrentHash);

    return () => {
      timeouts.forEach(window.clearTimeout);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToCurrentHash);
    };
  }, []);

  return null;
}
