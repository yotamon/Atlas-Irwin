import Link from "next/link";
import { connectCatalogTrackToIntelligence } from "@/app/studio/catalog-track-actions";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ObjectHeader } from "@/components/studio/object-header";
import { Status } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import type { Track } from "@/types/database";

export function CatalogTrackWorkspace({
  track,
  releaseTitle,
  artistId,
}: {
  track: Track;
  releaseTitle: string;
  artistId: string;
}) {
  const releaseHref = ensemblisArtistHref(`/studio/releases/${track.release_id}`, artistId);
  const hasMaster = Boolean(track.audio_url);

  return (
    <div className="studio-v2-page catalog-track-workspace">
      <ObjectHeader
        backHref={releaseHref}
        backLabel={releaseTitle}
        eyebrow="Track"
        title={track.title}
        subtitle={track.version ? `${releaseTitle} · ${track.version}` : releaseTitle}
        facts={[
          { label: "Track", value: track.track_number ?? track.display_order + 1 },
          { label: "Master", value: <Status tone={hasMaster ? "success" : "attention"}>{hasMaster ? "Audio attached" : "Needed"}</Status> },
          { label: "Intelligence", value: <Status tone="attention">Not linked yet</Status> },
        ]}
        actions={<Link href={releaseHref}>Back to release</Link>}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Master audio</span>
            <h2>{hasMaster ? "Use the master that is already attached" : "Add this song's master"}</h2>
            <p>{hasMaster
              ? "This exact song already has its canonical master. Ensemblis can connect that source to Music Intelligence without uploading the audio again."
              : "The master you add here belongs only to this song. Other tracks in the release keep their own audio and analysis."}</p>
          </div>
        </div>

        {hasMaster ? (
          <>
            <audio className="catalog-track-audio" controls preload="metadata" src={track.audio_url ?? undefined} />
            <div className="v2-calm-state compact">
              <strong>No re-upload needed.</strong>
              <p>Connect the existing master and Ensemblis will create the per-track intelligence identity, then queue structure, Moments and mastering analysis from this same source.</p>
              <form action={connectCatalogTrackToIntelligence}>
                <input type="hidden" name="track_id" value={track.id} />
                <input type="hidden" name="artist_id" value={artistId} />
                <button className="button primary" type="submit">Connect & analyze</button>
              </form>
            </div>
            <details className="v2-advanced-disclosure">
              <summary>Replace this master instead</summary>
              <p className="v2-muted-copy">Only upload a new file when the attached master is actually the wrong version or needs to be replaced.</p>
              <MediaUploader
                releaseId={track.release_id}
                trackId={track.id}
                artistId={artistId}
                defaultRole="master_audio"
                releaseMasterMode
              />
            </details>
          </>
        ) : (
          <MediaUploader
            releaseId={track.release_id}
            trackId={track.id}
            artistId={artistId}
            defaultRole="master_audio"
            releaseMasterMode
          />
        )}
      </section>
    </div>
  );
}
