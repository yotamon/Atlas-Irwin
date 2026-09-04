import Link from "next/link";
import { EnsemblisMark } from "@/components/ensemblis-logo";

export default function StudioNotFound() {
  return (
    <main className="studio-auth">
      <section>
        <div className="ensemblis-auth-brand">
          <span className="ensemblis-auth-symbol" aria-hidden><EnsemblisMark /></span>
          <div>
            <strong>Ensemblis</strong>
            <small>Music-aware artist growth</small>
          </div>
        </div>
        <h1>This workspace view doesn&apos;t exist</h1>
        <p>The link may be outdated, or the selected artist may no longer expose this surface.</p>
        <Link className="button primary" href="/studio">Back to Today</Link>
      </section>
    </main>
  );
}
