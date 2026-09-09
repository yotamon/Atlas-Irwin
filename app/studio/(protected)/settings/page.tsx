import Link from "next/link";
import { signOut } from "@/app/studio/actions";
import { Page, PageHeader, Section } from "@/components/studio/ui";
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
    <Page width="narrow" className="settings-page">
      <PageHeader
        eyebrow="Workspace control"
        title="Settings"
        description={`Identity, permissions, autonomy and workspace controls for ${artist.artistName}.`}
      />

      <Section eyebrow="Artist foundation" title="Teach Ensemblis the artist once">
        <div className="v2-settings-grid">
          <Link href={href("/studio/settings/artist")}><div><strong>Artist operating profile</strong></div><p>Goals, marketing involvement, scene, visibility and AI boundaries that change how Ensemblis works.</p><small>Set working relationship →</small></Link>
          <Link href={href("/studio/brand")}><div><strong>Brand profile</strong></div><p>Voice, visual world, audience and explicit creative rules.</p><small>Edit artist rules →</small></Link>
          <Link href={href("/studio/memory")}><div><strong>Artist Memory</strong></div><p>What Ensemblis currently believes about the artist, with source evidence available on demand.</p><small>Review memory →</small></Link>
        </div>
      </Section>

      <Section eyebrow="Control" title="Choose what Ensemblis can read, decide and do">
        <div className="v2-settings-grid">
          <Link href={href("/studio/connections")}><div><strong>Connections</strong></div><p>Music data, social channels and distribution providers live in one place.</p><small>Manage connections →</small></Link>
          <Link href={href("/studio/settings/autonomy")}><div><strong>Autonomy</strong></div><p>Set Assist, Prepare or Run by domain, with spend ceilings and hard safety boundaries.</p><small>Set autonomy →</small></Link>
          <Link href={href("/studio/settings/ai")}>
            <div><span className={`v2-dot ${gatewayConfigured ? "connected" : ""}`} aria-hidden /><strong>AI Control Center</strong></div>
            <p>{gatewayConfigured ? "AI routing and policy are configured." : "AI gateway configuration is still required."}</p><small>Review AI controls →</small>
          </Link>
        </div>
      </Section>

      <Section
        eyebrow="Maintenance"
        title="Workspace health"
        description="Technical integrity belongs here. Campaigns, outreach, publishing and creative work stay inside Grow or Create instead of becoming a second navigation system in Settings."
        action={<Link className="button secondary" href={href("/studio/data-health")}>Data health</Link>}
      >
        <span />
      </Section>

      <Section eyebrow="Account" title="Session">
        <form action={signOut}><button className="button ghost" type="submit">Sign out</button></form>
      </Section>
    </Page>
  );
}
