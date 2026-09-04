import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { StudioSidebar } from "@/components/studio/sidebar";

export const dynamic = "force-dynamic";

export default async function ProtectedStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);

  return (
    <div className="studio-shell">
      <StudioSidebar
        artistName={artist.artistName}
        workspaceName={artist.workspaceName}
      />
      <main className="studio-main">{children}</main>
    </div>
  );
}
