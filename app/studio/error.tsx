"use client";

import { ENSEMBLIS_PRODUCT } from "@/lib/ensemblis-product";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="studio-auth">
      <section>
        <div className="ensemblis-auth-brand">
          <span className="ensemblis-auth-symbol" aria-hidden>E</span>
          <div>
            <strong>{ENSEMBLIS_PRODUCT.name}</strong>
            <small>{ENSEMBLIS_PRODUCT.descriptor}</small>
          </div>
        </div>
        <h1>Something interrupted the workflow</h1>
        <p>{error.message || "Ensemblis could not complete that request."}</p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
