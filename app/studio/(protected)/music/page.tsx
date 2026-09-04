import Link from "next/link";
import { MusicGenerator } from "@/components/studio/music-generator";
import { MusicWorkspaceOverview } from "@/components/studio/music-workspace-overview";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { miniMaxGenerationCost } from "@/lib/music/generator";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

export default async function MusicPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  if (view === "generate") {
    const operational = asArtistScopedOperationalClient(supabase);
    const { data: brandRows, error: brandError } = await operational
      .from("brand_settings")
      .select("section,content")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .in("section", ["Brand essence", "Music world"]);
    if (brandError) throw new Error(brandError.message);

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
      <div className="studio-v2-page music-workspace-page">
        <PageHeader
          title="Create music"
          description={`Describe the musical idea for ${artist.artistName}. Ensemblis keeps the default path simple and exposes provider, timing and prompt controls only when you need them.`}
          action={<Link className="button" href={href("/studio/music")}>Back to music</Link>}
        />
        <MusicGenerator
          providers={providers}
          brandContext={brandContext}
          artistId={artist.artistId}
          artistName={artist.artistName}
        />
      </div>
    );
  }

  const growth = asGrowthClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const [vaultResult, releasesResult, tracksResult] = await Promise.all([
    growth
      .from("track_vault")
      .select("*")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    music
      .from("releases")
      .select("id,title,status,release_date,artwork_url,cover_alt,active_release")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .order("release_date", { ascending: false, nullsFirst: false }),
    music
      .from("tracks")
      .select("id,title,release_id,audio_url,is_primary")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId),
  ]);
  const firstError = [vaultResult, releasesResult, tracksResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  return (
    <div className="studio-v2-page music-workspace-page">
      <PageHeader
        title="Music"
        description={`One source-material workspace for ${artist.artistName}: unreleased tracks, canonical masters, Track Intelligence and the releases those tracks become.`}
        action={<Link className="button primary" href={href("/studio/music?view=generate")}>Create track</Link>}
      />
      <MusicWorkspaceOverview
        artistId={artist.artistId}
        artistName={artist.artistName}
        vaultTracks={vaultResult.data ?? []}
        releases={releasesResult.data ?? []}
        tracks={tracksResult.data ?? []}
      />
    </div>
  );
}
