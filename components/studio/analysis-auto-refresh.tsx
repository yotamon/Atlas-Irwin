"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AnalysisAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let refreshes = 0;
    let timer = 0;

    const schedule = () => {
      const delay = refreshes < 24 ? 5000 : 10000;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        refreshes += 1;
        router.refresh();
        // Typical deep audio passes take several minutes. Keep the UI live for up to
        // ten minutes without hammering the free deployment with rapid refreshes.
        if (refreshes < 72) schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, router]);

  return null;
}
