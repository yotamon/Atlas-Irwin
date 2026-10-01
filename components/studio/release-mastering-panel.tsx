import { ActiveMasteringPanel } from "@/components/studio/active-mastering-panel";
import { MasteringInspectorPanel } from "@/components/studio/mastering-inspector-panel";
import { MasterReadinessCard } from "@/components/studio/master-readiness-card";
import { MasteringReferencesPanel } from "@/components/studio/mastering-references-panel";
import { MasteringTechnicalReport } from "@/components/studio/mastering-technical-report";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { deriveMasterReadiness } from "@/lib/mastering/readiness";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { describeTrackAnalysis } from "@/lib/studio/track-analysis-state";
import type { Json } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function ReleaseMasteringPanel({ vaultTrack }: { vaultTrack: VaultTrack }) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const masteringDb = asMasteringClient(supabase);
  const referencesResult = await masteringDb
    .from("mastering_references")
    .select("label,reference_signature,track_vault_id")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("active", true)
    .eq("status", "ready")
    .limit(24);
  if (referencesResult.error) throw new Error(referencesResult.error.message);

  const catalogProfiles = (referencesResult.data ?? [])
    .filter((reference) => reference.track_vault_id !== vaultTrack.id)
    .map((reference) => ({
    title: reference.label,
    musicMap: {
      mastering_inspector: { reference_signature: reference.reference_signature },
    } as Json,
  }));
  const inspector = record(record(vaultTrack.audio_profile).mastering_inspector);
  const hasInspector = Object.keys(inspector).length > 0;
  const analysis = describeTrackAnalysis(vaultTrack.analysis, vaultTrack.audio_profile);
  const readiness = deriveMasterReadiness(vaultTrack.audio_profile, {
    audioUrl: vaultTrack.audio_url,
    mediaAssetId: vaultTrack.media_asset_id,
    analysisActive: analysis.isActive && !analysis.hasMusicMap,
    analysisFailed: analysis.needsRecovery && !analysis.hasMusicMap,
  });
  const statusLabel = readiness.status === "ready"
    ? "Ready"
    : readiness.status === "review"
      ? "Review suggested"
      : readiness.status === "fix_required"
        ? "Fix before release"
        : readiness.status === "pending"
          ? "Checking"
          : "Unverified";

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
        <span className="growth-active-label">{statusLabel}</span>
      </div>

      <MasterReadinessCard
        readiness={readiness}
        audioUrl={vaultTrack.audio_url}
        continueHref={vaultTrack.linked_release_id ? `/studio/releases/${vaultTrack.linked_release_id}/distribution` : null}
        replaceHref={vaultTrack.linked_release_id ? `/studio/releases/${vaultTrack.linked_release_id}?stage=overview#master-audio` : "/studio/music/import"}
      />

      {hasInspector ? (
        <>
          <ActiveMasteringPanel trackId={vaultTrack.id} sourceAudioUrl={vaultTrack.audio_url} readiness={readiness} />
          <MasteringReferencesPanel
            trackId={vaultTrack.id}
            canAddCurrent={readiness.status === "ready" || readiness.status === "review"}
          />
        </>
      ) : (
        <div className="v2-calm-state compact">
          <strong>Active Mastering unlocks after the latest mastering checks are available.</strong>
          <p>Refresh Track Intelligence first so every candidate can be rendered from deterministic source evidence.</p>
        </div>
      )}

      <details className="workspace-drawer">
        <summary>Measurements and reference comparison</summary>
        <MasteringInspectorPanel
          audioUrl={vaultTrack.audio_url}
          musicMap={vaultTrack.audio_profile}
          catalogProfiles={catalogProfiles}
        />
      </details>
      <MasteringTechnicalReport musicMap={vaultTrack.audio_profile} />
    </section>
  );
}
