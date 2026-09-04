import { StudioSidebar } from "@/components/studio/sidebar";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  listAccessibleArtists,
  resolveActiveArtistContext,
} from "@/lib/studio/artist-context";

export const dynamic = "force-dynamic";

export default async function ProtectedStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const [artist, artists] = await Promise.all([
    resolveActiveArtistContext(supabase, user),
    listAccessibleArtists(supabase, user),
  ]);

  return (
    <div className="studio-shell">
      <StudioSidebar
        artistId={artist.artistId}
        artists={artists.map((item) => ({
          artistId: item.artistId,
          artistName: item.artistName,
          workspaceName: item.workspaceName,
        }))}
      />
      <main className="studio-main">{children}</main>
    </div>
  );
}
