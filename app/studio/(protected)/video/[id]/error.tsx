"use client";

import Link from "next/link";

export default function VideoProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="video-error-state">
      <span className="section-label">Production paused safely</span>
      <h1>This step needs attention</h1>
      <p>{error.message || "Atlas could not finish this operation. No automatic creative retry or unapproved spend will happen."}</p>
      <div className="video-error-actions">
        <button className="button primary" type="button" onClick={reset}>Try this view again</button>
        <Link className="button" href="/studio/releases">Back to releases</Link>
      </div>
      {error.digest ? <small>Reference: {error.digest}</small> : null}
    </section>
  );
}
