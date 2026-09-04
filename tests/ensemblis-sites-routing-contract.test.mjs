import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function requireSnippets(path, snippets) {
  const text = await source(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain routing/domain contract: ${snippet}`);
  }
  return text;
}

test("domain migration stores provider state without activating pending hosts", async () => {
  const migration = await requireSnippets("supabase/migrations/20260904174000_ensemblis_sites_domain_operations.sql", [
    "add column if not exists provider text",
    "add column if not exists provider_ref text",
    "add column if not exists verification_state jsonb",
    "add column if not exists last_checked_at timestamptz",
    "create or replace function public.set_artist_site_primary_domain",
    "domain must be verified with active TLS before becoming primary",
    "create or replace function public.resolve_artist_site_hostname",
    "domain.verification_status = 'verified'",
    "domain.ssl_status = 'active'",
    "site.state = 'published'",
    "grant execute on function public.resolve_artist_site_hostname(text) to anon, authenticated",
  ]);
  assert.doesNotMatch(
    migration,
    /update\s+public\.artist_site_domains[\s\S]{0,300}verification_status\s*=\s*'verified'/i,
    "domain infrastructure migration must not activate an existing pending hostname",
  );
});

test("proxy hostname resolution uses only the anonymous public RPC", async () => {
  const resolver = await requireSnippets("lib/sites/proxy-host-resolver.ts", [
    "/rest/v1/rpc/resolve_artist_site_hostname",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "Authorization: `Bearer ${key}`",
    'cache: "no-store"',
  ]);
  assert.doesNotMatch(resolver, /SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|createServiceClient/);
});

test("proxy strips spoofable site headers and fails unknown tenant hosts closed", async () => {
  const proxy = await requireSnippets("proxy.ts", [
    'const INTERNAL_SITE_ID_HEADER = "x-ensemblis-site-id"',
    'const INTERNAL_SITE_HOST_HEADER = "x-ensemblis-site-host"',
    "headers.delete(INTERNAL_SITE_ID_HEADER)",
    "headers.delete(INTERNAL_SITE_HOST_HEADER)",
    "resolveSiteHostForProxy(host)",
    "getSiteUrl()",
    "isTrustedNonTenantHost(host)",
    'new NextResponse(null, { status: 404 })',
    'new NextResponse("Site temporarily unavailable.", { status: 503 })',
    "requestHeaders.set(INTERNAL_SITE_ID_HEADER, resolved.siteId)",
    "NextResponse.rewrite(rewriteUrl",
  ]);
  assert.doesNotMatch(proxy, /Atlas Irwin|atlasirwin\.com/i, "routing boundary must not special-case Atlas identity");
});

test("internal host runtime revalidates canonical hostname before rendering", async () => {
  await requireSnippets("app/__sites/[siteId]/[[...path]]/page.tsx", [
    'requestHeaders.get("x-ensemblis-site-id")',
    'requestHeaders.get("x-ensemblis-site-host")',
    "trustedSiteId !== siteId",
    "loadPublishedSiteByHostname(trustedHostname)",
    "runtime.site.id !== siteId",
    "if (path.length) notFound()",
    "getSiteTemplate(",
  ]);
});

test("Studio domain actions reserve canonical ownership before provider attachment", async () => {
  const actions = await requireSnippets("app/studio/sites-actions.ts", [
    "connectArtistSiteDomainAction",
    "normalizeSiteHostname",
    '.from("artist_site_domains")',
    'domain_type: "custom"',
    "const state = await provider.attach(hostname)",
    "persistProviderState",
    "refreshArtistSiteDomainAction",
    "verifyArtistSiteDomainAction",
    "setPrimaryArtistSiteDomainAction",
    "removeArtistSiteDomainAction",
    "Primary domains cannot be detached",
  ]);
  assert.ok(
    actions.indexOf('domain_type: "custom"') < actions.indexOf("await provider.attach(hostname)"),
    "canonical hostname reservation must happen before external provider attachment",
  );
});

test("Studio exposes DNS and guarded domain controls", async () => {
  await requireSnippets("app/studio/(protected)/sites/page.tsx", [
    "Connect domain",
    "DNS records required",
    "Refresh status",
    "Verify domain",
    "Make primary",
    "Detach",
    'domain.verification_status === "verified" && domain.ssl_status === "active"',
    'site.state === "published"',
  ]);
});
