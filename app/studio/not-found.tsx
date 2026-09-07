"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EnsemblisMark } from "@/components/ensemblis-logo";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

export default function StudioNotFound() {
  const searchParams = useSearchParams();
  const artistId = searchParams.get("artist")?.trim() || "";
  const homeHref = artistId ? ensemblisArtistHref("/studio", artistId) : "/studio";

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
        <p>The link may be outdated, or this surface may no longer exist for the active artist.</p>
        <Link className="button primary" href={homeHref}>Back to Today</Link>
      </section>
    </main>
  );
}
