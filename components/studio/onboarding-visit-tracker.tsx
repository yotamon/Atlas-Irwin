"use client";

import { useEffect, useRef } from "react";
import { recordOnboardingStartedAction } from "@/app/studio/onboarding/actions";

export function OnboardingVisitTracker({ artistId }: { artistId: string }) {
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void recordOnboardingStartedAction(artistId).catch(() => undefined);
  }, [artistId]);

  return null;
}