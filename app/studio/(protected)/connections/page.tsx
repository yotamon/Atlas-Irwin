import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import {
  SOCIAL_PLATFORM_DEFINITIONS,
  SOCIAL_PLATFORM_KEYS,
} from "@/lib/marketing/social-platforms";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asSocialClient } from "@/lib/studio/social-db";
import { hasSocialPlatformEnv } from "@/lib/studio/social-connections";

export default async function ConnectionsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const social = asSocialClient(supabase);

  const [spotifyResult, soundCloudResult, socialResult] = await Promise.all([
    supabase
      .from("spotify_accounts")
      .select("last_synced_at")
      .eq("owner_id", user.id)
      .maybeSingle(),
    supabase
      .from("soundcloud_accounts")
      .select("last_synced_at")
      .eq("owner_id", user.id)
      .maybeSingle(),
    social
      .from("social_channel_accounts")
      .select("platform,status,display_name,username,can_publish")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId),
  ]);

  const dataConnections = [
    {
      href: ensemblisArtistHref("/studio/spotify", artist.artistId),
      title: "Spotify",
      connected: Boolean(spotifyResult.data),
      detail: spotifyResult.data?.last_synced_at
        ? "Connected and previously synced"
        : "Connect listening and catalog data",
    },
    {
      href: ensemblisArtistHref("/studio/soundcloud", artist.artistId),
      title: "SoundCloud",
      connected: Boolean(soundCloudResult.data),
      detail: soundCloudResult.data?.last_synced_at
        ? "Connected and previously synced"
        : "Connect listening and catalog data",
    },
  ];

  const socialAccounts = new Map(
    (socialResult.data ?? []).map((account) => [account.platform, account]),
  );

  const socialConnections = SOCIAL_PLATFORM_KEYS.map((platform) => {
    const definition = SOCIAL_PLATFORM_DEFINITIONS[platform];
    const account = socialAccounts.get(platform);
    const connected = account?.status === "connected";
    const configured = hasSocialPlatformEnv(platform);

    return {
      href: ensemblisArtistHref(`/studio/settings/social/${platform}`, artist.artistId),
      title: definition.label,
      connected,
      publishing: Boolean(account?.can_publish),
      detail: connected
        ? `${account?.display_name || account?.username || "Account connected"} · active for ${artist.artistName}`
        : configured
          ? `Ready to connect for ${artist.artistName}`
          : "Provider setup is still required",
    };
  });

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Connections"
        description={`Choose what Ensemblis can read from and where it can act for ${artist.artistName}. Disconnected channels stay outside planning and execution.`}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Music & performance data</span>
            <h2>Give Ensemblis reliable evidence</h2>
          </div>
        </div>
        <div className="v2-settings-grid">
          {dataConnections.map((connection) => (
            <Link href={connection.href} key={connection.href}>
              <div>
                <span className={`v2-dot ${connection.connected ? "connected" : ""}`} aria-hidden />
                <strong>{connection.title}</strong>
              </div>
              <p>{connection.detail}</p>
              <small>{connection.connected ? "Manage connection" : "Connect service"} →</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Social channels</span>
            <h2>Only connected channels enter campaign plans</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Ensemblis excludes disconnected channels deterministically, even when an AI model suggests them.
        </p>
        <div className="v2-settings-grid">
          {socialConnections.map((connection) => (
            <Link href={connection.href} key={connection.href}>
              <div>
                <span className={`v2-dot ${connection.connected ? "connected" : ""}`} aria-hidden />
                <strong>{connection.title}</strong>
              </div>
              <p>{connection.detail}</p>
              <small>
                {connection.connected
                  ? connection.publishing
                    ? "Planning + publishing enabled"
                    : "Planning enabled · review publishing permission"
                  : "Connect channel"} →
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Distribution</span>
            <h2>Delivery providers stay behind an explicit approval boundary</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Configure and inspect distribution separately from social publishing. Ensemblis never treats delivery as live availability automatically.
        </p>
        <div className="actions">
          <Link className="button" href={ensemblisArtistHref("/studio/distribution", artist.artistId)}>Open Distribution</Link>
        </div>
      </section>
    </div>
  );
}
