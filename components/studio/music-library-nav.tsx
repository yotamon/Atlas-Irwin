import Link from "next/link";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

export function MusicLibraryNav({ artistId, active }: { artistId: string; active: "tracks" | "releases" }) {
  return (
    <nav className="release-work-subnav music-library-nav" aria-label="Music library">
      <Link
        href={ensemblisArtistHref("/studio/music", artistId)}
        aria-current={active === "tracks" ? "page" : undefined}
        className={active === "tracks" ? "is-active" : undefined}
      >
        Tracks
      </Link>
      <Link
        href={ensemblisArtistHref("/studio/releases", artistId)}
        aria-current={active === "releases" ? "page" : undefined}
        className={active === "releases" ? "is-active" : undefined}
      >
        Releases
      </Link>
    </nav>
  );
}
