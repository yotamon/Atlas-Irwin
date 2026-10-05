import Link from "next/link";
import {
  approveReleaseVisual,
  returnReleaseVisualToDesign,
  selectReleaseVisualSource,
} from "@/app/studio/release-visual-actions";
import { ReleaseVisualComposer } from "@/components/studio/release-visual-composer";
import { ReleaseVisualMessageForm } from "@/components/studio/release-visual-message-form";
import { ButtonLink, Disclosure, PageHeader, Status } from "@/components/studio/ui";
import { WorkflowStepper } from "@/components/studio/ux-v4-widgets";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import {
  RELEASE_VISUAL_STAGES,
  type ReleaseVisualStage,
} from "@/lib/marketing/release-visual";
import type { loadReleaseVisualWorkspace } from "@/lib/marketing/release-visual-workspace";

type Workspace = Awaited<ReturnType<typeof loadReleaseVisualWorkspace>>;

function stageLabel(stage: ReleaseVisualStage) {
  if (stage === "use") return "Use";
  return stage[0].toUpperCase() + stage.slice(1);
}

function HiddenContext({ artistId, contentItemId }: { artistId: string; contentItemId: string }) {
  return (
    <>
      <input type="hidden" name="artist_id" value={artistId} />
      <input type="hidden" name="content_item_id" value={contentItemId} />
    </>
  );
}

function SourceImage({ src, label }: { src: string; label: string }) {
  return (
    <div className="release-visual-source-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} />
    </div>
  );
}

function SourceChoices({
  workspace,
  artistId,
}: {
  workspace: Workspace;
  artistId: string;
}) {
  return (
    <div className="release-visual-source-choices">
      {(workspace.release.artwork_url || workspace.release.cover_asset) ? (
        <form action={selectReleaseVisualSource}>
          <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
          <input type="hidden" name="source_asset_id" value="" />
          <button className="release-visual-source-option" type="submit">
            {workspace.release.artwork_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={workspace.release.artwork_url} alt="" />
            ) : <span className="release-visual-source-placeholder">Cover</span>}
            <span>
              <strong>Release artwork</strong>
              <small>Use the canonical cover as the identity anchor.</small>
            </span>
          </button>
        </form>
      ) : null}

      {workspace.eligibleSources.map(({ asset, url }) => url ? (
        <form action={selectReleaseVisualSource} key={asset.id}>
          <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
          <input type="hidden" name="source_asset_id" value={asset.id} />
          <button className="release-visual-source-option" type="submit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" />
            <span>
              <strong>{typeof (asset.metadata as Record<string, unknown>)?.title === "string"
                ? String((asset.metadata as Record<string, unknown>).title)
                : "Release visual"}</strong>
              <small>{asset.width && asset.height ? `${asset.width}×${asset.height}` : "Approved release media"}</small>
            </span>
          </button>
        </form>
      ) : null)}
    </div>
  );
}

function SourceStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  return (
    <section className="studio-section release-visual-stage">
      <span className="section-label">Source</span>
      <h2>Choose the release identity to preserve</h2>
      <p>Release Visual starts from approved artwork. Visual Brand DNA can guide the treatment, but it never replaces the release source.</p>

      {workspace.eligibleSources.length || workspace.release.artwork_url || workspace.release.cover_asset ? (
        <SourceChoices workspace={workspace} artistId={artistId} />
      ) : (
        <div className="v2-calm-state compact">
          <strong>No approved visual source is attached yet.</strong>
          <p>Add the release cover or attach another approved image in Media Library. This does not require a musical Moment.</p>
          <ButtonLink href={ensemblisArtistHref(`/studio/releases/${workspace.release.id}`, artistId)} variant="primary">
            Add release artwork
          </ButtonLink>
        </div>
      )}
    </section>
  );
}

function MessageStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  if (!workspace.source) return <SourceStage workspace={workspace} artistId={artistId} />;
  return (
    <section className="studio-section release-visual-stage">
      <div className="release-visual-stage-grid">
        <SourceImage src={workspace.source.url} label={workspace.source.label} />
        <div className="release-visual-stage-copy">
          <span className="section-label">Message</span>
          <Status tone="success">Source ready</Status>
          <h2>What should this visual communicate?</h2>
          <p>Start from a useful release message, then edit the exact wording. The default is chosen from the real release lifecycle.</p>

          <ReleaseVisualMessageForm
            artistId={artistId}
            contentItemId={workspace.content.id}
            releaseTitle={workspace.release.title}
            artistName={workspace.release.artist || "Artist"}
            releaseDate={workspace.release.release_date}
            recommendedIntent={workspace.recommendedMessage}
          />

          <Disclosure label="Use a different approved visual">
            <SourceChoices workspace={workspace} artistId={artistId} />
          </Disclosure>
        </div>
      </div>
    </section>
  );
}

function DesignStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  if (!workspace.draftSpec) return <MessageStage workspace={workspace} artistId={artistId} />;
  return (
    <section className="studio-section release-visual-stage">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Design</span>
          <h2>Compose the actual social artwork</h2>
          <p>Choose the format and layout. The cover stays the release identity; Ensemblis handles extension, safe areas and exact typography.</p>
        </div>
        <Status>Zero generative spend</Status>
      </div>
      <ReleaseVisualComposer
        artistId={artistId}
        contentItemId={workspace.content.id}
        initialSpec={workspace.draftSpec}
      />
    </section>
  );
}

function ReviewStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const asset = workspace.candidateAsset;
  if (!asset?.public_url) return <DesignStage workspace={workspace} artistId={artistId} />;
  return (
    <section className="studio-section release-visual-stage">
      <div className="release-visual-stage-grid">
        <SourceImage src={asset.public_url} label="Release Visual candidate" />
        <div className="release-visual-stage-copy">
          <span className="section-label">Review</span>
          <Status tone="attention">Needs approval</Status>
          <h2>Approve the exact image you see</h2>
          <p>This PNG has already been rendered at the target dimensions. Approval promotes these exact bytes and their composition spec into the reusable release creative family.</p>
          <div className="actions">
            <form action={approveReleaseVisual}>
              <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
              <input type="hidden" name="media_asset_id" value={asset.id} />
              <button className="button primary" type="submit">Approve visual</button>
            </form>
            <form action={returnReleaseVisualToDesign}>
              <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
              <button className="button" type="submit">Change design</button>
            </form>
          </div>
          <small className="release-visual-helper">Approval does not overwrite the original cover. The rendered visual remains a separate Media Library asset with source lineage.</small>
        </div>
      </div>
    </section>
  );
}

function UseStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const asset = workspace.primaryAsset;
  if (!asset?.public_url) return <ReviewStage workspace={workspace} artistId={artistId} />;

  return (
    <section className="studio-section release-visual-stage">
      <div className="release-visual-stage-grid">
        <SourceImage src={asset.public_url} label="Approved Release Visual" />
        <div className="release-visual-stage-copy">
          <span className="section-label">Use</span>
          <Status tone="success">Approved</Status>
          <h2>Your static release visual is ready</h2>
          <p>Use it as-is, create another social format from the same composition, or continue into motion without changing the approved visual identity.</p>

          <div className="release-visual-use-actions">
            <a className="button primary" href={asset.public_url} target="_blank" rel="noreferrer">Open image</a>
            <Link className="button" href={ensemblisArtistHref(`/studio/library?release=${workspace.release.id}`, artistId)}>View lineage</Link>
          </div>

          <div className="release-visual-next-cards">
            <article>
              <span className="section-label">Another format</span>
              <strong>Story · portrait · square</strong>
              <p>Reuse the approved composition system instead of cropping the raster.</p>
              <span className="v2-muted-copy">Format rendering is available from this approved visual family.</span>
            </article>
            <article>
              <span className="section-label">Optional motion</span>
              <strong>Animate this artwork</strong>
              <p>Use this exact approved visual as the motion identity anchor in Living Artwork.</p>
              <span className="v2-muted-copy">Motion stays optional. The approved static visual is already complete.</span>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReleaseVisualWorkflow({
  artistId,
  workspace,
}: {
  artistId: string;
  workspace: Workspace;
}) {
  const current = workspace.stage;
  return (
    <div className="studio-v2-page release-visual-page">
      <PageHeader
        eyebrow="Create"
        title="Release Visual"
        description={`Turn ${workspace.release.title} artwork into a polished social visual first. Animation is optional after you approve the static design.`}
        actions={
          <ButtonLink href={ensemblisArtistHref(`/studio/releases/${workspace.release.id}`, artistId)}>
            Back to release
          </ButtonLink>
        }
      />

      <div className="release-visual-context-strip">
        <div>
          <span className="section-label">Creating for</span>
          <strong>{workspace.release.title}</strong>
          <small>{workspace.source ? workspace.source.label : "Visual source needed"} · {workspace.content.title}</small>
        </div>
        <Status>{stageLabel(current)}</Status>
      </div>

      <WorkflowStepper
        current={current}
        steps={RELEASE_VISUAL_STAGES.map((stage) => ({ id: stage, label: stageLabel(stage) }))}
      />

      {current === "source" ? <SourceStage workspace={workspace} artistId={artistId} /> : null}
      {current === "message" ? <MessageStage workspace={workspace} artistId={artistId} /> : null}
      {current === "design" ? <DesignStage workspace={workspace} artistId={artistId} /> : null}
      {current === "review" ? <ReviewStage workspace={workspace} artistId={artistId} /> : null}
      {current === "use" ? <UseStage workspace={workspace} artistId={artistId} /> : null}

      <Disclosure label="Why static comes first">
        <p>Release Visual separates design from motion. You can finish a Story or feed image with no generative spend. If you later animate it, Living Artwork uses the approved visual as its exact first and last frame source instead of inventing a second release identity.</p>
      </Disclosure>
    </div>
  );
}
