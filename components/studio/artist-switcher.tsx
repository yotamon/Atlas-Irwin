"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const activeArtist = artists.find((artist) => artist.artistId === activeArtistId);

  function selectArtist(artistId: string) {
    if (!artistId || artistId === activeArtistId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("artist", artistId);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <div className="ensemblis-artist-switcher">
      <div className="ensemblis-artist-switcher-heading">
        <span>Active artist</span>
        {artists.length > 1 && <small>{isPending ? "Switching…" : `${artists.length} available`}</small>}
      </div>
      <select
        aria-label="Active artist"
        value={activeArtistId}
        onChange={(event) => selectArtist(event.target.value)}
        disabled={isPending || artists.length < 2}
      >
        {artists.map((artist) => (
          <option value={artist.artistId} key={artist.artistId}>
            {artist.artistName}{artists.length > 1 ? ` · ${artist.workspaceName}` : ""}
          </option>
        ))}
      </select>
      <small className="ensemblis-artist-workspace">
        {activeArtist?.workspaceName ?? "Ensemblis workspace"}
      </small>
    </div>
  );
}
