import Link from "next/link";
import { signOut } from "@/app/studio/actions";
import { PageHeader } from "@/components/studio/ui";
import { ensemblisAiGatewayConfigured } from "@/lib/ai/gateway";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

// Connections owns social_channel_accounts. Campaign Brain only plans for connected platforms.
// The autonomy route remains href="/studio/settings/autonomy"; the artist-aware helper preserves context. Set autonomy rules here, not in provider plumbing.
export default async function SettingsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const gatewayConfigured = ensemblisAiGatewayConfigured();

  return (
    <div className="studio-v2-page">
      <PageHeader title="Settings" description={`Artist rules, autonomy and workspace controls for ${artist.artistName}.`} />

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Artist foundation</span><h2>Teach Ensemblis the artist once</h2></div></div>
        <div className="v2-settings-grid">
          <Link href={href("/studio/brand")}><div><strong>Brand profile</strong></div><p>Voice, visual world, audience and explicit creative rules.</p><small>Edit artist rules →</small></Link>
          <Link href={href("/studio/memory")}><div><strong>Artist Memory</strong></div><p>What Ensemblis currently believes, with source evidence available on demand.</p><small>Review memory →</small></Link>
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Control</span><h2>Choose what Ensemblis can read, decide and do</h2></div></div>
        <div className="v2-settings-grid">
          <Link href={href("/studio/connections")}><div><strong>Connections</strong></div><p>Music data, social channels and distribution providers live in one place.</p><small>Manage connections →</small></Link>
          <Link href={href("/studio/settings/autonomy")}><div><strong>Autonomy</strong></div><p>Set Assist, Prepare or Run by domain, with spend ceilings and hard safety boundaries.</p><small>Set autonomy →</small></Link>
          <Link href={href("/studio/settings/ai")}>
            <div><span className={`v2-dot ${gatewayConfigured ? "connected" : ""}`} aria-hidden /><strong>AI Control Center</strong></div>
            <p>{gatewayConfigured ? "AI routing and policy are configured." : "AI gateway configuration is still required."}</p><small>Review AI controls →</small>
          </Link>
        </div>
      </section>

      <details className="v2-section v2-compact-section">
        <summary><strong>Advanced tools</strong><span>Maintenance, specialist workflows and debugging</span></summary>
        <p className="v2-muted-copy">These remain available for exceptional work without defining the everyday Ensemblis experience.</p>
        <div className="actions">
          <Link className="button" href={href("/studio/data-health")}>Data health</Link>
          <Link className="button" href={href("/studio/campaigns")}>Campaign Brain</Link>
          <Link className="button" href={href("/studio/outreach")}>Outreach</Link>
          <Link className="button" href={href("/studio/content")}>Content Lab</Link>
          <Link className="button" href={href("/studio/calendar")}>Publishing calendar</Link>
        </div>
      </details>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Account</span><h2>Session</h2></div></div>
        <form action={signOut}><button className="button" type="submit">Sign out</button></form>
      </section>
    </div>
  );
}
