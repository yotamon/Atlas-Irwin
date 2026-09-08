"use client";

import Link from "next/link";

export default function ReleaseDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="studio-v2-page release-object-workspace">
      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Release recovery</span>
            <h1>This release could not finish loading</h1>
            <p>The release itself is still safe. Retry the view, or return to Releases and continue working elsewhere.</p>
          </div>
        </div>

        <div className="v2-calm-state compact">
          <strong>No release data was changed by this failed view.</strong>
          <p>If a secondary intelligence or campaign service is temporarily unavailable, retrying should restore the workspace without requiring any re-upload.</p>
          {error.digest ? <small>Reference: {error.digest}</small> : null}
        </div>

        <div className="actions">
          <button className="button primary" type="button" onClick={reset}>Try again</button>
          <Link className="button" href="/studio/releases">Back to Releases</Link>
        </div>
      </section>
    </div>
  );
}
