import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { atlasAiGatewayConfigured } from "@/lib/ai/gateway";
import {
  SOCIAL_PLATFORM_DEFINITIONS,
  SOCIAL_PLATFORM_KEYS,
} from "@/lib/marketing/social-platforms";
import { asSocialClient } from "@/lib/studio/social-db";
import { hasSocialPlatformEnv } from "@/lib/studio/social-connections";

export default async function SettingsPage() {
  const { supabase, user } = await requireStudioAdmin();
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
      .eq("owner_id", user.id),
  ]);

  const dataConnections = [
    {
      href: "/studio/spotify",
      title: "Spotify",
      connected: Boolean(spotifyResult.data),
      detail: spotifyResult.data?.last_synced_at ? "Connected and previously synced" : "Connect or review sync",
    },
    {
      href: "/studio/soundcloud",
      title: "SoundCloud",
      connected: Boolean(soundCloudResult.data),
      detail: soundCloudResult.data?.last_synced_at ? "Connected and previously synced" : "Connect or review sync",
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
      href: `/studio/settings/social/${platform}`,
      title: definition.label,
      connected,
      detail: connected
        ? `${account?.display_name || account?.username || "Account connected"} · campaign planning enabled`
        : configured
          ? "Ready to connect · excluded from campaign plans until connected"
          : "OAuth app setup required · excluded from campaign plans",
      publishing: Boolean(account?.can_publish),
    };
  });

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Settings"
        description="Connections, brand rules and advanced maintenance. These should rarely interrupt the release workflow."
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Data connections</span>
            <h2>Where Atlas gets music data</h2>
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
              <small>{connection.connected ? "Manage connection" : "Set up connection"} →</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Social channels</span>
            <h2>Campaign Brain only plans for connected platforms</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Connect the accounts Atlas should actively include in campaign plans. A disconnected channel is deterministically excluded, even if an AI model tries to suggest it.
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
                    ? "Planning + publishing permission"
                    : "Planning connected · manage permissions"
                  : "Connect channel"} →
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Creative system</span>
            <h2>Teach Atlas your taste once</h2>
          </div>
        </div>
        <div className="v2-settings-grid">
          <Link href="/studio/brand">
            <div><strong>Brand profile</strong></div>
            <p>Voice, visual world, audience and reusable creative guidance.</p>
            <small>Edit brand profile →</small>
          </Link>
          <Link href="/studio/analytics">
            <div><strong>Learning memory</strong></div>
            <p>Review performance conclusions Atlas may reuse in future plans.</p>
            <small>Review learnings →</small>
          </Link>
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">AI & generation</span>
            <h2>One control plane for model quality, routing and cost</h2>
          </div>
        </div>
        <div className="v2-settings-grid">
          <Link href="/studio/settings/ai">
            <div>
              <span className={`v2-dot ${atlasAiGatewayConfigured() ? "connected" : ""}`} aria-hidden />
              <strong>AI Control Center</strong>
            </div>
            <p>{atlasAiGatewayConfigured() ? "Gateway healthy · task routing, quality gates, budgets and learning are active" : "Gateway needs configuration before AI tasks can run"}</p>
            <small>Review AI intelligence →</small>
          </Link>
        </div>
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Advanced</span>
            <h2>Maintenance and manual controls</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          These tools remain available for exceptions and debugging, but they are intentionally outside the daily workflow.
        </p>
        <div className="actions">
          <Link className="button" href="/studio/data-health">Data health</Link>
          <Link className="button" href="/studio/campaigns">Campaign Brain</Link>
          <Link className="button" href="/studio/outreach">Outreach</Link>
          <Link className="button" href="/studio/content">Content Lab</Link>
          <Link className="button" href="/studio/calendar">Publishing calendar</Link>
        </div>
      </section>
    </div>
  );
}
