import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";

export default async function SettingsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const [spotifyResult, soundCloudResult] = await Promise.all([
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
  ]);

  const connections = [
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

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Settings"
        description="Connections, brand rules and advanced maintenance. These should rarely interrupt the release workflow."
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Connections</span>
            <h2>Where Atlas gets data</h2>
          </div>
        </div>
        <div className="v2-settings-grid">
          {connections.map((connection) => (
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
