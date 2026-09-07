"use client";

import Link from "next/link";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reference = error.digest?.trim();

  return (
    <main className="studio-auth">
      <section role="alert">
        <div className="ensemblis-auth-brand">
          <span className="ensemblis-auth-symbol" aria-hidden><EnsemblisMark /></span>
          <div>
            <strong>{ENSEMBLIS_PRODUCT.name}</strong>
            <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
          </div>
        </div>
        <h1>Something interrupted the workflow</h1>
        <p>Ensemblis could not complete this view safely. Your existing artist data has not been changed.</p>
        {reference ? <p className="ensemblis-error-reference">Reference: <code>{reference}</code></p> : null}
        <div className="actions">
          <button className="button primary" onClick={reset}>Try again</button>
          <Link className="button" href="/studio">Back to Today</Link>
        </div>
      </section>
    </main>
  );
}
