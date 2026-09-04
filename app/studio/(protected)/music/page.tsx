import { MusicGenerator } from "@/components/studio/music-generator";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { miniMaxGenerationCost } from "@/lib/music/generator";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

export default async function MusicLabPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const { data: brandRows } = await operational
    .from("brand_settings")
    .select("section,content")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .in("section", ["Brand essence", "Music world"]);
  const brandContext = (brandRows ?? [])
    .map((row) => `${row.section}: ${(row.content as { text?: string } | null)?.text ?? ""}`)
    .filter((value) => !value.endsWith(": "))
    .join(" ");
  const miniMaxModel = process.env.MINIMAX_MUSIC_MODEL?.trim() || "music-2.6";
  const providers = [
    {
      id: "minimax" as const,
      name: "MiniMax Music",
      model: miniMaxModel,
      enabled: Boolean(process.env.MINIMAX_API_KEY?.trim()),
      price: miniMaxGenerationCost(miniMaxModel) === 0 ? "Free trial model" : "$0.15 / generation",
      note: "Cheap default. Up to five minutes per generation; set a -free model in the environment when your account has trial access.",
    },
    {
      id: "eleven" as const,
      name: "Eleven Music",
      model: process.env.ELEVENLABS_MUSIC_MODEL?.trim() || "music_v2",
      enabled: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
      price: "$0.15 / minute",
      note: "Higher-control option. Precise duration and a composition-plan flow for vocal tracks.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Music Lab"
        description={`Generate drafts for ${artist.artistName} inside Ensemblis. The prompt architecture uses only this artist's own music and brand context, pushes one signature idea per track, and makes provider cost visible before you spend.`}
      />
      <MusicGenerator
        providers={providers}
        brandContext={brandContext}
        artistId={artist.artistId}
        artistName={artist.artistName}
      />
    </>
  );
}
