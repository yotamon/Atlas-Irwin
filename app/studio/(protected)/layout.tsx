import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StudioContextBar } from "@/components/studio/context-bar";
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
  const onboarding = supabase as unknown as SupabaseClient<OnboardingDatabase>;
  const { data: activation, error: activationError } = await onboarding
    .from("artist_activation_events")
    .select("event_type")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .in("event_type", ["first_moment_approved", "onboarding_dismissed"]);
  if (activationError) throw new Error(activationError.message);
  const activationEvents = new Set((activation ?? []).map((event) => event.event_type));
  const showFirstUseGuide = !activationEvents.has("first_moment_approved") && !activationEvents.has("onboarding_dismissed");

  return (
    <div className="studio-shell">
      <StudioSidebar
        artistId={artist.artistId}
        artists={artists.map((item) => ({
          artistId: item.artistId,
          artistName: item.artistName,
          workspaceName: item.workspaceName,
        }))}
      />
      <div className="ensemblis-workspace-shell">
        <StudioContextBar artistId={artist.artistId} artistName={artist.artistName} />
        {showFirstUseGuide ? (
          <aside className="ensemblis-first-use-nudge" aria-label="First useful Ensemblis loop">
            <span><strong>Start with the music</strong><small>Finish the first track → intelligence → Moment loop when it is useful.</small></span>
            <Link href={`/studio/onboarding?artist=${encodeURIComponent(artist.artistId)}`}>Continue first-use guide</Link>
          </aside>
        ) : null}
        <main className="studio-main">{children}</main>
      </div>
    </div>
  );
}
