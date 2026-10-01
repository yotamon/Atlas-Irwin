import { retryMasteringReference, removeMasteringReference, addCurrentMasterReference } from "@/app/studio/mastering-reference-actions";
import { AnalysisAutoRefresh } from "@/components/studio/analysis-auto-refresh";
import { MediaUploader } from "@/components/studio/media-uploader";
import { SubmitButton } from "@/components/studio/submit-button";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

function statusLabel(status: string) {
  if (status === "ready") return "Ready";
  if (status === "running") return "Analyzing";
  if (status === "queued") return "Queued";
  if (status === "pending") return "Waiting";
  if (status === "failed") return "Needs retry";
  return status;
}

export async function MasteringReferencesPanel({
  trackId,
  canAddCurrent,
}: {
  trackId: string;
  canAddCurrent: boolean;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const mastering = asMasteringClient(supabase);
  const references = await mastering.from("mastering_references")
    .select("id,label,kind,track_vault_id,status,error,active,created_at")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(20);
  if (references.error) throw new Error(references.error.message);

  const rows = references.data ?? [];
  const ready = rows.filter((row) => row.status === "ready");
  const active = rows.some((row) => ["pending", "queued", "running"].includes(row.status));
  const currentIncluded = rows.some((row) => row.kind === "approved_master" && row.track_vault_id === trackId && row.status === "ready");

  return (
    <details className="workspace-drawer mastering-reference-panel">
      <AnalysisAutoRefresh active={active} />
      <summary>Mastering references · {ready.length} ready</summary>
      <p className="v2-muted-copy">
        Only references you explicitly choose influence catalog comparison and optional mastering targets. Other Vault tracks are ignored.
      </p>

      {rows.length ? (
        <div className="mastering-reference-list">
          {rows.map((reference) => (
            <div className="mastering-reference-row" data-status={reference.status} key={reference.id}>
              <span>
                <strong>{reference.label}</strong>
                <small>{reference.kind === "approved_master" ? "Approved Ensemblis master" : "External reference"} · {statusLabel(reference.status)}</small>
                {reference.status === "failed" && reference.error ? <em>{reference.error}</em> : null}
              </span>
              <div className="mastering-reference-actions">
                {reference.status === "failed" && reference.kind === "uploaded_reference" ? (
                  <form action={retryMasteringReference}>
                    <input type="hidden" name="reference_id" value={reference.id} />
                    <SubmitButton className="text-button" pendingLabel="Retrying…">Retry</SubmitButton>
                  </form>
                ) : null}
                <form action={removeMasteringReference}>
                  <input type="hidden" name="reference_id" value={reference.id} />
                  <SubmitButton className="text-button" pendingLabel="Removing…">Remove</SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="v2-calm-state compact">
          <strong>No trusted mastering references yet.</strong>
          <p>Ensemblis will avoid artist-catalog tonal targeting until you explicitly choose reference masters.</p>
        </div>
      )}

      <div className="mastering-reference-options">
        {canAddCurrent && !currentIncluded ? (
          <form action={addCurrentMasterReference}>
            <input type="hidden" name="track_id" value={trackId} />
            <SubmitButton className="button" pendingLabel="Adding reference…">Use this approved master as a reference</SubmitButton>
          </form>
        ) : currentIncluded ? <p className="v2-muted-copy">This master is already part of your trusted reference set.</p> : null}

        <details className="studio-advanced-details">
          <summary>
            <span>Add an external reference</span>
            <small>Upload a WAV, FLAC or other supported audio file. It will be analyzed as a reference, not added to Music.</small>
          </summary>
          <div className="mastering-reference-upload">
            <MediaUploader
              artistId={artist.artistId}
              defaultRole="master_audio"
              masteringReferenceMode
            />
          </div>
        </details>
      </div>
    </details>
  );
}

