import Link from "next/link";
import { ReleaseCatalog } from "@/components/studio/release-catalog";
import { EmptyState, PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type {
  ArtistScopedHomepagePlacement,
  ArtistScopedRelease,
} from "@/types/artist-scoped-music-database";

type ReleaseWithPlacement = ArtistScopedRelease & {
  homepage_placements: ArtistScopedHomepagePlacement[];
};

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    publish?: string;
    homepage?: string;
    view?: string;
  }>;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = asArtistScopedMusicClient(supabase);
  const params = await searchParams;
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  let query = db
    .from("releases")
    .select("*")
    .eq("artist_id", artist.artistId)
    .order("updated_at", { ascending: false });
  if (params.status) query = query.eq("status", params.status);
  if (params.publish) query = query.eq("publish_state", params.publish);
  if (params.q) query = query.ilike("title", `%${params.q}%`);
  const [{ data: releases }, { data: placements }] = await Promise.all([
    query,
    db
      .from("homepage_placements")
      .select("*")
      .eq("artist_id", artist.artistId),
  ]);

  const placementByRelease = new Map(
    (placements ?? []).map((placement) => [placement.release_id, placement]),
  );
  const enriched: ReleaseWithPlacement[] = (releases ?? []).map((release) => ({
    ...release,
    homepage_placements: placementByRelease.has(release.id)
      ? [placementByRelease.get(release.id)!]
      : [],
  }));

  const filtered =
    params.homepage === "visible"
      ? enriched.filter((release) =>
          release.homepage_placements.some((placement) => placement.enabled),
        )
      : params.homepage === "hidden"
        ? enriched.filter(
            (release) =>
              !release.homepage_placements.some((placement) => placement.enabled),
          )
        : enriched;

  return (
    <div className="studio-v2-page release-catalog-page">
      <PageHeader
        title="Releases"
        description={`Move ${artist.artistName}'s music from preparation to release day and then into a healthy long-term catalog. Open a release only when you need its full workflow.`}
        action={<Link className="button primary" href={href("/studio/releases/new")}>New release</Link>}
      />
      {filtered.length ? (
        <ReleaseCatalog
          releases={filtered}
          view={params.view === "table" ? "table" : "grid"}
          filters={params}
          artistId={artist.artistId}
        />
      ) : (
        <EmptyState
          title="The catalog starts here"
          body={`Create the first release for ${artist.artistName}, or import an existing catalog.`}
          href={href("/studio/releases/new")}
          label="Create release"
        />
      )}
    </div>
  );
}
