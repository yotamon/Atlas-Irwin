import { PageHeader } from "@/components/studio/ui";
import { ReleaseForm } from "@/components/studio/release-form";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

export default async function NewRelease() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);

  return (
    <div className="studio-v2-page v2-narrow-page">
      <PageHeader
        title="New release"
        description={`Create a release workspace for ${artist.artistName}. Ensemblis prepares the operational structure without spending money or publishing anything.`}
      />
      <ReleaseForm artistName={artist.artistName} />
    </div>
  );
}
