"use client";

import Link from "next/link";

export default function OnboardingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ensemblis-onboarding-shell">
      <main className="ensemblis-onboarding-card">
        <div className="ensemblis-onboarding-intro">
          <span className="section-label">Activation paused</span>
          <h1>We could not read the next step safely</h1>
          <p>Your music and release state were not changed. Retry the derived onboarding view, or continue in Music without repeating setup.</p>
        </div>
        <section className="ensemblis-onboarding-action" role="alert">
          <span className="section-label">Recovery</span>
          <h2>Nothing was submitted or overwritten</h2>
          <p>Ensemblis fails closed when it cannot resolve the active artist or canonical music state.</p>
          <div className="actions"><button className="button primary" type="button" onClick={reset}>Try again</button><Link className="button" href="/studio/music">Open Music</Link></div>
        </section>
      </main>
    </div>
  );
}
