import Link from "next/link";
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
            <h2>{hasMaster ? "Connect this exact song to Music Intelligence" : "Add this song's master"}</h2>
            <p>{hasMaster
              ? "This catalog row has audio, but it does not yet have a reliable per-track intelligence identity. Upload the canonical master here to bind analysis to this exact song."
              : "The master you add here belongs only to this song. Other tracks in the release keep their own audio and analysis."}</p>
          </div>
        </div>
        {hasMaster ? <audio className="catalog-track-audio" controls preload="metadata" src={track.audio_url ?? undefined} /> : null}
        <MediaUploader
          releaseId={track.release_id}
          trackId={track.id}
          artistId={artistId}
          defaultRole="master_audio"
          releaseMasterMode
        />
      </section>
    </div>
  );
}
