"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AnalysisAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let refreshes = 0;
    const timer = window.setInterval(() => {
      refreshes += 1;
      router.refresh();
      if (refreshes >= 40) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return null;
}
