import Link from "next/link";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

export function StudioContextBar({
  artistId,
  artistName,
}: {
  artistId: string;
  artistName: string;
}) {
  return (
    <header className="ensemblis-context-bar">
      <div className="ensemblis-context-identity" aria-label={`Active artist: ${artistName}`}>
        <span className="ensemblis-context-kicker">Active artist</span>
        <strong>{artistName}</strong>
      </div>

      <nav className="ensemblis-context-actions" aria-label="Global workspace actions">
        <Link className="ensemblis-context-link" href={ensemblisArtistHref("/studio/inbox", artistId)}>
          Needs you
        </Link>
        <Link className="button primary" href={ensemblisArtistHref("/studio/create", artistId)}>
          Create
        </Link>
      </nav>
    </header>
  );
}
