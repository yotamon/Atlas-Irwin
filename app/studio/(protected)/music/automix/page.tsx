import Link from "next/link";
import { AutoMixWorkflow } from "@/components/studio/automix-workflow";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

export default async function AutoMixPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; track?: string; mix?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const tracks = await music
    .from("tracks")
    .select("id,title,release_id,audio_url,is_primary")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .order("created_at", { ascending: true });
  if (tracks.error) throw new Error(tracks.error.message);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const initialSource = params.source === "local" || params.source === "catalog"
    ? params.source
    : undefined;

  return (
    <div className="studio-v2-page automix-workspace-page en-automix-v4-page">
      <PageHeader
        eyebrow="Mix"
        title="AutoMix"
        description="Choose the music, shape the set, review the transitions, then render the version you approve."
        action={<Link className="button" href={href("/studio/music?view=mixes")}>Back to mixes</Link>}
      />
      <AutoMixWorkflow
        artistId={artist.artistId}
        artistName={artist.artistName}
        tracks={tracks.data ?? []}
        initialSource={initialSource}
        initialTrackId={params.track}
        initialMixId={params.mix}
      />
    </div>
  );
}
