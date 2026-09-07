import { ActiveMasteringPanel } from "@/components/studio/active-mastering-panel";
import { MasteringInspectorPanel } from "@/components/studio/mastering-inspector-panel";
import { MasteringTechnicalReport } from "@/components/studio/mastering-technical-report";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { hasMusicIntelligenceMap } from "@/lib/studio/track-analysis-state";
import type { Json } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function statusLabel(musicMap: Json) {
  const status = record(record(musicMap).mastering_inspector).status;
  if (status === "fix_before_release") return "Fix before release";
  if (status === "ready_review_suggested") return "Review suggested";
  if (status === "ready") return "Ready";
  return "Available";
}

export async function ReleaseMasteringPanel({ vaultTrack }: { vaultTrack: VaultTrack }) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const catalogResult = await growth
    .from("track_vault")
    .select("id,title,audio_profile")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .neq("id", vaultTrack.id);
  if (catalogResult.error) throw new Error(catalogResult.error.message);

  const catalogProfiles = (catalogResult.data ?? [])
    .filter((track) => hasMusicIntelligenceMap(track.audio_profile))
    .map((track) => ({ title: track.title, musicMap: track.audio_profile as Json }));
  const inspector = record(record(vaultTrack.audio_profile).mastering_inspector);
  const hasInspector = Object.keys(inspector).length > 0;

  return (
    <section className="v2-section v2-full-column" id="mastering">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Mastering Inspector</span>
          <h2>Verify the master before distribution, then improve it only when the evidence supports it</h2>
          <p>
            Loudness, true peak, dynamics, stereo, codec stress, beat stability and artist-catalog comparison stay attached to the same canonical master.
          </p>
        </div>
        <span className="growth-active-label">{statusLabel(vaultTrack.audio_profile)}</span>
      </div>

      <MasteringInspectorPanel
        audioUrl={vaultTrack.audio_url}
        musicMap={vaultTrack.audio_profile}
        catalogProfiles={catalogProfiles}
      />

      {hasInspector ? (
        <ActiveMasteringPanel trackId={vaultTrack.id} sourceAudioUrl={vaultTrack.audio_url} />
      ) : (
        <div className="v2-calm-state compact">
          <strong>Active Mastering unlocks after the latest mastering checks are available.</strong>
          <p>Refresh Track Intelligence first so every candidate can be rendered from deterministic source evidence.</p>
        </div>
      )}

      <MasteringTechnicalReport musicMap={vaultTrack.audio_profile} />
    </section>
  );
}
