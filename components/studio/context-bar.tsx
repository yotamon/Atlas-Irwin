import Link from "next/link";
import { CommandPalette } from "@/components/studio/command-palette";
import { StudioLocationTrail } from "@/components/studio/location-trail";
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
      <StudioLocationTrail artistId={artistId} artistName={artistName} />

      <nav className="ensemblis-context-actions" aria-label="Global workspace actions">
        <CommandPalette artistId={artistId} />
        <Link className="ensemblis-context-link" href={ensemblisArtistHref("/studio/needs-you", artistId)}>
          Needs You
        </Link>
        <Link className="button primary" href={ensemblisArtistHref("/studio/create", artistId)}>
          Create
        </Link>
      </nav>
    </header>
  );
}
