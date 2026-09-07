"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ensemblisArtistHref, resolveEnsemblisRouteContext } from "@/lib/ensemblis-product";

export function StudioLocationTrail({ artistId, artistName }: { artistId: string; artistName: string }) {
  const pathname = usePathname();
  const context = resolveEnsemblisRouteContext(pathname);

  return (
    <div className="ensemblis-location-trail" aria-label={`Current workspace: ${artistName}, ${context.area}${context.detail ? `, ${context.detail}` : ""}`}>
      <span className="ensemblis-location-artist">{artistName}</span>
      <span aria-hidden>·</span>
      <Link href={ensemblisArtistHref(context.parentHref, artistId)}>{context.area}</Link>
      {context.detail ? <><span aria-hidden>/</span><strong>{context.detail}</strong></> : null}
    </div>
  );
}
