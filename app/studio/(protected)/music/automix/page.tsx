import Link from "next/link";
import { AutoMixStudio } from "@/components/studio/automix-studio";
import { DjIntelligencePanel } from "@/components/studio/dj-intelligence-panel";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

export default async function AutoMixPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const tracks = await music.from("tracks")
    .select("id,title,release_id,audio_url,is_primary")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .order("created_at", { ascending: true });
  if (tracks.error) throw new Error(tracks.error.message);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  return (
    <div className="studio-v2-page automix-workspace-page">
      <PageHeader
        title="DJ & Mixes"
        description={`Personal set intelligence, professional planning and offline rendering from ${artist.artistName}'s mastered catalog.`}
        action={<Link className="button" href={href("/studio/music")}>Back to music</Link>}
      />
      <DjIntelligencePanel artistId={artist.artistId} />
      <AutoMixStudio
        artistId={artist.artistId}
        artistName={artist.artistName}
        tracks={tracks.data ?? []}
      />
    </div>
  );
}
