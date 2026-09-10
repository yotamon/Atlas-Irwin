import { Suspense } from "react";
import { StudioToast } from "@/components/studio/toast";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dismissOnboardingAction } from "@/app/studio/onboarding/actions";
import { StudioContextBar } from "@/components/studio/context-bar";
import { StudioMobileNavigation } from "@/components/studio/mobile-navigation";
import { StudioMotionStage } from "@/components/studio/studio-motion-stage";
import { StudioSidebar } from "@/components/studio/sidebar";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  listAccessibleArtists,
  resolveActiveArtistContext,
} from "@/lib/studio/artist-context";
import type { OnboardingDatabase } from "@/types/onboarding-database";

export const dynamic = "force-dynamic";

export default async function ProtectedStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const [artist, artists] = await Promise.all([
    resolveActiveArtistContext(supabase, user),
    listAccessibleArtists(supabase, user),
  ]);
  const navigationArtists = artists.map((item) => ({
    artistId: item.artistId,
    artistName: item.artistName,
    workspaceName: item.workspaceName,
  }));
  const onboarding = supabase as unknown as SupabaseClient<OnboardingDatabase>;
  const { data: activation, error: activationError } = await onboarding
    .from("artist_activation_events")
    .select("event_type")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .in("event_type", ["first_moment_approved", "onboarding_dismissed"]);
  const activationEvents = new Set((activation ?? []).map((event) => event.event_type));
  // A non-essential onboarding lookup must never take down the working Studio.
  const showFirstUseGuide = !activationError
    && !activationEvents.has("first_moment_approved")
    && !activationEvents.has("onboarding_dismissed");

  return (
    <div className="studio-shell">
      <StudioSidebar artistId={artist.artistId} artists={navigationArtists} />
      <div className="ensemblis-workspace-shell">
        <StudioContextBar artistId={artist.artistId} artistName={artist.artistName} />
        {showFirstUseGuide ? (
          <aside className="ensemblis-first-use-nudge" aria-label="First useful Ensemblis loop">
            <span><strong>Start with the music</strong><small>Finish the first track → intelligence → Moment loop when it is useful.</small></span>
            <div className="ensemblis-first-use-actions">
              <Link href={`/studio/onboarding?artist=${encodeURIComponent(artist.artistId)}`}>Continue guide</Link>
              <form action={dismissOnboardingAction}>
                <input type="hidden" name="artist_id" value={artist.artistId} />
                <button className="text-button" type="submit">Dismiss</button>
              </form>
            </div>
          </aside>
        ) : null}
        <main className="studio-main">
          <Suspense fallback={null}><StudioToast /></Suspense>
          <StudioMotionStage>{children}</StudioMotionStage>
        </main>
      </div>
      <StudioMobileNavigation artistId={artist.artistId} artists={navigationArtists} />
    </div>
  );
}
