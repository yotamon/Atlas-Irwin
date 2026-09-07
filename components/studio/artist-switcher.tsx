"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { ensemblisArtistSwitchHref } from "@/lib/ensemblis-product";

type ArtistSwitcherOption = {
  artistId: string;
  artistName: string;
  workspaceName: string;
};

export function ArtistSwitcher({
  activeArtistId,
  artists,
}: {
  activeArtistId: string;
  artists: ArtistSwitcherOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const activeArtist = artists.find((artist) => artist.artistId === activeArtistId);

  function selectArtist(artistId: string) {
    if (!artistId || artistId === activeArtistId) return;
    startTransition(() => {
      router.push(ensemblisArtistSwitchHref(pathname, artistId));
    });
  }

  return (
    <div className="ensemblis-artist-switcher" aria-busy={isPending || undefined}>
      <div className="ensemblis-artist-switcher-heading">
        <span>Active artist</span>
        {artists.length > 1 ? <small aria-live="polite">{isPending ? "Switching…" : `${artists.length} available`}</small> : null}
      </div>

      {artists.length > 1 ? (
        <select
          aria-label="Active artist"
          value={activeArtistId}
          onChange={(event) => selectArtist(event.target.value)}
          disabled={isPending}
        >
          {artists.map((artist) => (
            <option value={artist.artistId} key={artist.artistId}>
              {artist.artistName} · {artist.workspaceName}
            </option>
          ))}
        </select>
      ) : (
        <div className="ensemblis-artist-static" aria-label={`Active artist: ${activeArtist?.artistName ?? "Artist"}`}>
          <strong>{activeArtist?.artistName ?? "Artist"}</strong>
          <small>{activeArtist?.workspaceName ?? "Ensemblis workspace"}</small>
        </div>
      )}

      {artists.length > 1 ? <small className="ensemblis-artist-workspace">
        {activeArtist?.workspaceName ?? "Ensemblis workspace"}
      </small> : null}
    </div>
  );
}
