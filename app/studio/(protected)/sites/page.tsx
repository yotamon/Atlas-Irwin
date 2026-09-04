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
            Ensemblis will create a private draft from the active artist and live release catalog. Publishing is versioned and reversible, and the artist-facing site contains no Ensemblis product chrome.
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

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Sites"
        description={`${artist.artistName}'s owned web layer. Draft privately, publish immutable versions, and keep rollback one action away.`}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Status</span>
            <h2>{site.state === "published" ? "Live site" : "Private draft"}</h2>
          </div>
        </div>
        <div className="v2-settings-grid">
          <div>
            <div><strong>Template</strong></div>
            <p>{site.template_key}</p>
            <small>Versioned presentation rules</small>
          </div>
          <div>
            <div><strong>Published version</strong></div>
            <p>{published ? `v${published.version_number}` : "Not published yet"}</p>
            <small>{dateLabel(published?.published_at)}</small>
          </div>
          <div>
            <div><strong>Draft version</strong></div>
            <p>{draft ? `v${draft.version_number}` : "No active draft"}</p>
            <small>{draft ? `Created ${dateLabel(draft.created_at)}` : "Refresh to create the next draft"}</small>
          </div>
          <div>
            <div><strong>Primary domain</strong></div>
            <p>{primaryDomain?.hostname || "No primary domain yet"}</p>
            <small>{primaryDomain ? `${primaryDomain.verification_status} · TLS ${primaryDomain.ssl_status}` : "Shadow path remains available for validation"}</small>
          </div>
        </div>

        <div className="actions">
          <Link className="button primary" href={`/site-preview/${site.id}`} target="_blank" rel="noreferrer">
            Preview private draft
          </Link>
          {site.state === "published" ? (
            <Link className="button" href={`/sites/${site.slug}`} target="_blank" rel="noreferrer">Open published shadow site</Link>
          ) : null}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Content sync</span>
            <h2>Refresh from the current artist and release catalog</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          Refreshing only changes the private draft snapshot. A published version remains immutable until you explicitly publish a newer draft.
        </p>
        <div className="actions">
          <form action={refreshArtistSiteDraftAction}>
            <input type="hidden" name="siteId" value={site.id} />
            <button className="button" type="submit">Refresh draft from Ensemblis</button>
          </form>
          {draft ? (
            <form action={resetDraftThemeAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <button className="button" type="submit">Reset draft theme</button>
            </form>
          ) : null}
          {draft ? (
            <form action={publishArtistSiteAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <button className="button primary" type="submit">Publish v{draft.version_number}</button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Domains</span>
            <h2>Connect and verify artist domains</h2>
          </div>
        </div>
        <p className="v2-muted-copy">
          A domain becomes routable only after the provider confirms ownership, DNS configuration, active TLS, a published site version, and an explicit primary-domain selection.
        </p>

        <form action={connectArtistSiteDomainAction} className="ensemblis-domain-connect-form">
          <input type="hidden" name="siteId" value={site.id} />
          <label>
            <span>Custom domain</span>
            <input
              type="text"
              name="hostname"
              required
              inputMode="url"
              autoComplete="url"
              placeholder="artist.example.com"
            />
          </label>
          <button className="button primary" type="submit">Connect domain</button>
        </form>

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
        ) : (
          <p className="v2-muted-copy">No hostname is attached yet.</p>
        )}
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Version history</span>
            <h2>Every publication is recoverable</h2>
          </div>
        </div>
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
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Deployments</span>
            <h2>Shared runtime publication log</h2>
          </div>
        </div>
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
      </section>
    </div>
  );
}
