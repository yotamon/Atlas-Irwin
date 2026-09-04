import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import {
  connectArtistSiteDomainAction,
  createArtistSiteAction,
  publishArtistSiteAction,
  refreshArtistSiteDomainAction,
  refreshArtistSiteDraftAction,
  removeArtistSiteDomainAction,
  resetDraftThemeAction,
  rollbackArtistSiteAction,
  setPrimaryArtistSiteDomainAction,
  verifyArtistSiteDomainAction,
} from "@/app/studio/sites-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asSitesClient } from "@/lib/sites/db";
import { listSiteTemplates } from "@/lib/sites/templates/registry";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

type DnsRecordView = {
  type: string;
  name: string;
  value: string;
  reason: string;
};

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function domainVerificationState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { message: null as string | null, dns: [] as DnsRecordView[] };
  }
  const record = value as { message?: unknown; dns?: unknown };
  const dns = Array.isArray(record.dns)
    ? record.dns.flatMap((item): DnsRecordView[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const candidate = item as Record<string, unknown>;
        if (
          typeof candidate.type !== "string" ||
          typeof candidate.name !== "string" ||
          typeof candidate.value !== "string"
        ) return [];
        return [{
          type: candidate.type,
          name: candidate.name,
          value: candidate.value,
          reason: typeof candidate.reason === "string" ? candidate.reason : "routing",
        }];
      })
    : [];
  return {
    message: typeof record.message === "string" ? record.message : null,
    dns,
  };
}

export default async function SitesPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const sites = asSitesClient(supabase);
  const siteResult = await sites
    .from("artist_sites")
    .select("*")
    .eq("artist_id", artist.artistId)
    .maybeSingle();

  if (siteResult.error) throw new Error(siteResult.error.message);
  const site = siteResult.data;

  if (!site) {
    const templates = listSiteTemplates();
    return (
      <div className="studio-v2-page">
        <PageHeader
          title="Sites"
          description={`Launch ${artist.artistName}'s owned web presence from the music, releases and identity Ensemblis already understands.`}
        />

        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Owned web</span>
              <h2>Create a music-aware artist site, not another empty website project</h2>
            </div>
          </div>
          <p className="v2-muted-copy">
            Ensemblis creates a private draft from the active artist and release catalog. You review the real site before anything becomes public, and every publication remains reversible.
          </p>
          <div className="v2-settings-grid">
            {templates.map((template) => (
              <div key={`${template.key}@${template.version}`}>
                <div><strong>{template.name}</strong></div>
                <p>{template.description}</p>
                <small>{template.supports.join(" · ")}</small>
              </div>
            ))}
          </div>
          <form action={createArtistSiteAction} className="actions">
            <button className="button primary" type="submit">Create private site draft</button>
          </form>
        </section>
      </div>
    );
  }

  const [versionsResult, domainsResult, deploymentsResult] = await Promise.all([
    sites
      .from("artist_site_versions")
      .select("*")
      .eq("site_id", site.id)
      .order("version_number", { ascending: false }),
    sites
      .from("artist_site_domains")
      .select("*")
      .eq("site_id", site.id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
    sites
      .from("artist_site_deployments")
      .select("*")
      .eq("site_id", site.id)
      .order("requested_at", { ascending: false })
      .limit(10),
  ]);
  for (const result of [versionsResult, domainsResult, deploymentsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const versions = versionsResult.data ?? [];
  const domains = domainsResult.data ?? [];
  const deployments = deploymentsResult.data ?? [];
  const draft = versions.find((version) => version.id === site.draft_version_id) ?? null;
  const published = versions.find((version) => version.id === site.published_version_id) ?? null;
  const rollbackCandidates = versions.filter((version) => version.status === "superseded").slice(0, 5);
  const primaryDomain = domains.find((domain) => domain.is_primary) ?? null;
  const primaryDomainReady = Boolean(
    primaryDomain
    && primaryDomain.verification_status === "verified"
    && primaryDomain.ssl_status === "active",
  );
  const hasPublishableDraft = Boolean(draft && draft.id !== site.published_version_id);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Sites"
        description={`${artist.artistName}'s owned web presence. Review what is live, preview changes and publish only when the artist-facing result is right.`}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Website</span>
            <h2>{site.state === "published" ? "Your artist site is live" : "Your site is still private"}</h2>
          </div>
        </div>
        <div className="v2-settings-grid">
          <div>
            <div><strong>Public status</strong></div>
            <p>{site.state === "published" ? "Live" : "Private"}</p>
            <small>{published ? `Last published ${dateLabel(published.published_at)}` : "Nothing has been published yet"}</small>
          </div>
          <div>
            <div><strong>Changes</strong></div>
            <p>{hasPublishableDraft ? "Changes ready to review" : "Published version is current"}</p>
            <small>{draft ? `Private draft v${draft.version_number}` : "No active draft"}</small>
          </div>
          <div>
            <div><strong>Domain</strong></div>
            <p>{primaryDomain?.hostname || "No custom domain yet"}</p>
            <small>{primaryDomain ? (primaryDomainReady ? "Connected and secure" : "Connection needs attention") : "You can connect one when the site is ready"}</small>
          </div>
        </div>

        <div className="actions">
          <Link className="button primary" href={`/site-preview/${site.id}`} target="_blank" rel="noreferrer">
            Preview private draft
          </Link>
          {hasPublishableDraft && draft ? (
            <form action={publishArtistSiteAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <button className="button primary" type="submit">Publish reviewed changes</button>
            </form>
          ) : null}
          {site.state === "published" ? (
            <Link className="button" href={`/sites/${site.slug}`} target="_blank" rel="noreferrer">Open live site</Link>
          ) : null}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Content</span>
            <h2>Keep the site aligned with the current artist and releases</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Updating creates a new private draft only. The live site never changes until you explicitly publish the reviewed result.
        </p>
        <form action={refreshArtistSiteDraftAction} className="actions">
          <input type="hidden" name="siteId" value={site.id} />
          <button className="button" type="submit">Update private draft from Ensemblis</button>
        </form>
      </section>

      {!primaryDomain ? (
        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Domain</span>
              <h2>Connect the artist's own domain</h2>
            </div>
          </div>
          <p className="v2-muted-copy">Add the hostname you want fans to visit. Ensemblis will tell you only if a setup step still needs attention.</p>
          <form action={connectArtistSiteDomainAction} className="ensemblis-domain-connect-form">
            <input type="hidden" name="siteId" value={site.id} />
            <label>
              <span>Custom domain</span>
              <input type="text" name="hostname" required inputMode="url" autoComplete="url" placeholder="artist.example.com" />
            </label>
            <button className="button primary" type="submit">Connect domain</button>
          </form>
        </section>
      ) : !primaryDomainReady ? (
        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Needs attention</span>
              <h2>Finish connecting {primaryDomain.hostname}</h2>
            </div>
          </div>
          <p className="v2-muted-copy">The domain is not fully verified and secure yet. Use the technical details below only for the remaining setup step.</p>
          <div className="actions">
            {primaryDomain.provider ? (
              <form action={refreshArtistSiteDomainAction}>
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="domainId" value={primaryDomain.id} />
                <button className="button" type="submit">Check connection again</button>
              </form>
            ) : null}
            {primaryDomain.provider ? (
              <form action={verifyArtistSiteDomainAction}>
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="domainId" value={primaryDomain.id} />
                <button className="button primary" type="submit">Verify domain</button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      <details className="v2-advanced-disclosure">
        <summary>Advanced site, domain and recovery controls</summary>
        <div className="v2-section">
          <div className="v2-section-heading">
            <div><span className="section-label">Technical state</span><h2>Domain details</h2></div>
          </div>
          {domains.length ? (
            <div className="ensemblis-domain-list">
              {domains.map((domain) => {
                const state = domainVerificationState(domain.verification_state);
                const ready = domain.verification_status === "verified" && domain.ssl_status === "active";
                return (
                  <article className="ensemblis-domain-card" key={domain.id}>
                    <div className="ensemblis-domain-card-head">
                      <div>
                        <strong>{domain.hostname}</strong>
                        <p>{domain.domain_type === "managed" ? "Ensemblis managed hostname" : "Custom domain"}</p>
                      </div>
                      <span>{domain.is_primary ? "Primary" : ready ? "Ready" : domain.verification_status}</span>
                    </div>
                    <div className="ensemblis-domain-meta">
                      <small>Provider: {domain.provider || "managed"}</small>
                      <small>Verification: {domain.verification_status}</small>
                      <small>TLS: {domain.ssl_status}</small>
                      <small>Checked: {dateLabel(domain.last_checked_at)}</small>
                    </div>
                    {state.message ? <p className="v2-muted-copy">{state.message}</p> : null}
                    {state.dns.length ? (
                      <div className="ensemblis-domain-dns">
                        <strong>DNS records required</strong>
                        {state.dns.map((record, index) => (
                          <div key={`${record.type}-${record.name}-${index}`}>
                            <code>{record.type}</code>
                            <code>{record.name}</code>
                            <code>{record.value}</code>
                            <small>{record.reason}</small>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="actions">
                      {domain.provider ? (
                        <form action={refreshArtistSiteDomainAction}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <input type="hidden" name="domainId" value={domain.id} />
                          <button className="button" type="submit">Refresh status</button>
                        </form>
                      ) : null}
                      {domain.provider && !ready ? (
                        <form action={verifyArtistSiteDomainAction}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <input type="hidden" name="domainId" value={domain.id} />
                          <button className="button" type="submit">Verify domain</button>
                        </form>
                      ) : null}
                      {ready && site.state === "published" && !domain.is_primary ? (
                        <form action={setPrimaryArtistSiteDomainAction}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <input type="hidden" name="domainId" value={domain.id} />
                          <button className="button primary" type="submit">Make primary</button>
                        </form>
                      ) : null}
                      {domain.domain_type === "custom" && !domain.is_primary ? (
                        <form action={removeArtistSiteDomainAction}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <input type="hidden" name="domainId" value={domain.id} />
                          <button className="button" type="submit">Detach</button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p className="v2-muted-copy">No hostname is attached yet.</p>}
        </div>

        <div className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Theme</span><h2>Draft recovery</h2></div></div>
          {draft ? (
            <form action={resetDraftThemeAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <button className="button" type="submit">Reset draft theme</button>
            </form>
          ) : <p className="v2-muted-copy">No active draft to reset.</p>}
        </div>

        <div className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Version history</span><h2>Every publication is recoverable</h2></div></div>
          <div className="v2-settings-grid">
            {versions.map((version) => (
              <div key={version.id}>
                <div><strong>v{version.version_number} · {version.status}</strong></div>
                <p>{version.id === site.published_version_id ? "Current production snapshot" : version.id === site.draft_version_id ? "Current private draft" : "Historical snapshot"}</p>
                <small>{version.published_at ? `Published ${dateLabel(version.published_at)}` : `Created ${dateLabel(version.created_at)}`}</small>
              </div>
            ))}
          </div>
          {rollbackCandidates.length ? (
            <div className="actions">
              {rollbackCandidates.map((version) => (
                <form action={rollbackArtistSiteAction} key={version.id}>
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="versionId" value={version.id} />
                  <button className="button" type="submit">Restore v{version.version_number}</button>
                </form>
              ))}
            </div>
          ) : null}
        </div>

        <div className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">Deployments</span><h2>Publication log</h2></div></div>
          {deployments.length ? (
            <div className="v2-settings-grid">
              {deployments.map((deployment) => (
                <div key={deployment.id}>
                  <div><strong>{deployment.status}</strong></div>
                  <p>{deployment.provider}</p>
                  <small>{dateLabel(deployment.completed_at || deployment.requested_at)}</small>
                </div>
              ))}
            </div>
          ) : <p className="v2-muted-copy">No publication has been deployed yet.</p>}
        </div>
      </details>
    </div>
  );
}
