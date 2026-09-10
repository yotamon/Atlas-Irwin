import Link from "next/link";
import { AutoMixRenderRecovery } from "@/components/studio/automix-render-recovery";
import { DjIntelligencePanel } from "@/components/studio/dj-intelligence-panel";
import { LibraryBridgePanel } from "@/components/studio/library-bridge-panel";
import { LocalSetBuilderWorkspace } from "@/components/studio/local-set-builder-workspace";
import { RekordboxImportPanel } from "@/components/studio/rekordbox-import-panel";
import { SetBuilderWorkspace } from "@/components/studio/set-builder-workspace";
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
        description={`Plan, audition, revise and render professional sets from ${artist.artistName}'s catalog or a paired local DJ library.`}
        action={<Link className="button" href={href("/studio/music")}>Back to music</Link>}
      />
      <DjIntelligencePanel artistId={artist.artistId} />
      <LibraryBridgePanel artistId={artist.artistId} />
      <RekordboxImportPanel artistId={artist.artistId} />
      <LocalSetBuilderWorkspace artistId={artist.artistId} artistName={artist.artistName} />
      <SetBuilderWorkspace
        artistId={artist.artistId}
        artistName={artist.artistName}
        tracks={tracks.data ?? []}
      />
      <AutoMixRenderRecovery artistId={artist.artistId} />
    </div>
  );
}
