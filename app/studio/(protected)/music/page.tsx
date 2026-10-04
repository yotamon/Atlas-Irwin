import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MixLibrary } from "@/components/studio/mix-library";
import { MusicGenerator } from "@/components/studio/music-generator";
import { MusicLibraryNav } from "@/components/studio/music-library-nav";
import { MusicWorkspaceOverview } from "@/components/studio/music-workspace-overview";
import { CompactEvidence } from "@/components/studio/ux-v4-widgets";
import { PageHeader, Status } from "@/components/studio/ui";
import { loadArtistOperatingContext } from "@/lib/artist-operating/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { miniMaxGenerationCost } from "@/lib/music/generator";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import type { AutoMixDatabase } from "@/types/automix-database";

export default async function MusicPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const { view, q = "" } = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  if (view === "mixes") {
    const automix = supabase as unknown as SupabaseClient<AutoMixDatabase>;
    let mixQuery = automix
      .from("automix_jobs")
      .select("*")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId);
    if (q) mixQuery = mixQuery.ilike("name", `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
    const jobs = await mixQuery.order("updated_at", { ascending: false }).limit(60);
    if (jobs.error) throw new Error(jobs.error.message);
    return (
      <div className="studio-v2-page music-workspace-page">
        <PageHeader
          title="Music"
          description={`Tracks, releases and mixes for ${artist.artistName}.`}
          action={<Link className="button primary" href={href("/studio/music/automix")}>New mix</Link>}
        />
        <MusicLibraryNav artistId={artist.artistId} active="mixes" />
        <MixLibrary artistId={artist.artistId} jobs={jobs.data ?? []} query={q} />
      </div>
    );
  }

  const operatingContext = await loadArtistOperatingContext({ db: supabase, artist });
  const aiMusicAllowed = operatingContext.profile.aiPolicy.musicAllowed;

  if (view === "add") {
    return (
      <div className="studio-v2-page music-workspace-page">
        <PageHeader
          title="Add music"
          description="Add the music Ensemblis should work from."
          action={<Link className="button" href={href("/studio/music")}>Back to music</Link>}
        />

        <section className="create-intent-list" aria-label="Ways to add music">
          <Link className="create-intent-row" href={href("/studio/music/import")}>
            <span className="create-intent-index">01</span>
            <span className="create-intent-copy">
              <small>Existing music</small>
              <strong>Add a mastered track</strong>
              <span>Upload the master. Analysis starts automatically.</span>
            </span>
            <b>Add master →</b>
          </Link>

          <Link className="create-intent-row" href={href("/studio/releases/new")}>
            <span className="create-intent-index">02</span>
            <span className="create-intent-copy">
              <small>Catalog</small>
              <strong>Add or prepare a release</strong>
              <span>Create the release and connect its tracks, artwork and release details.</span>
            </span>
            <b>Add release →</b>
          </Link>

          {aiMusicAllowed ? <Link className="create-intent-row" href={href("/studio/music?view=generate")}>
            <span className="create-intent-index">03</span>
            <span className="create-intent-copy">
              <small>Optional AI music</small>
              <strong>Create something new</strong>
              <span>Generate a draft when AI music is part of this artist&apos;s process.</span>
            </span>
            <b>Create music →</b>
          </Link> : null}
        </section>

        <CompactEvidence label="How Ensemblis uses your source">
          <p>Once a master exists, Ensemblis can analyze it and reuse that musical evidence across release, creative and growth decisions.</p>
          {aiMusicAllowed ? <p>AI generation stays optional and never replaces the artist&apos;s real source material by default.</p> : null}
        </CompactEvidence>
      </div>
    );
  }

  if (view === "generate" && !aiMusicAllowed) {
    return (
      <div className="studio-v2-page music-workspace-page">
        <PageHeader
          title="AI music is off for this artist"
          description={`${artist.artistName} is configured to use existing music rather than AI music generation. This is enforced on the server, not only hidden in the interface.`}
          action={<Link className="button" href={href("/studio/music?view=add")}>Back to add music</Link>}
        />
        <section className="v2-section v2-compact-section">
          <div className="v2-section-heading compact">
            <div>
              <span className="section-label">Artist capability policy</span>
              <h2>Keep the creative process source-first</h2>
              <p>Upload the artist&apos;s mastered track and Ensemblis can still analyze, market, distribute and grow it. AI does not need to be part of the music-making identity.</p>
            </div>
            <Status>Disabled</Status>
          </div>
          <div className="actions">
            <Link className="button primary" href={href("/studio/music/import")}>Add mastered music</Link>
            <Link className="button" href={href("/studio/settings/artist")}>Artist Profile</Link>
          </div>
        </section>
      </div>
    );
  }

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
          description={`Describe the musical idea for ${artist.artistName}. AI music is enabled explicitly for this artist; Ensemblis still keeps the creative intent ahead of technical controls.`}
          action={<Link className="button" href={href("/studio/music?view=add")}>Back to add music</Link>}
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
      .select("id,title,version,release_id,audio_url,is_primary,track_number,display_order")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .order("release_id")
      .order("display_order"),
  ]);
  const firstError = [vaultResult, releasesResult, tracksResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  return (
    <div className="studio-v2-page music-workspace-page">
      <PageHeader
        title="Music"
        description={`Find the track, release or mix you want to work on for ${artist.artistName}.`}
        action={<Link className="button primary" href={href("/studio/music?view=add")}>Add music</Link>}
      />
      <MusicLibraryNav artistId={artist.artistId} active="tracks" />
      <MusicWorkspaceOverview
        artistId={artist.artistId}
        artistName={artist.artistName}
        vaultTracks={vaultResult.data ?? []}
        releases={releasesResult.data ?? []}
        tracks={tracksResult.data ?? []}
        query={q}
      />
    </div>
  );
}