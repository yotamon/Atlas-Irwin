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
    "NextResponse.rewrite(rewriteUrl",
  ]);
  assert.doesNotMatch(proxy, /Atlas Irwin|atlasirwin\.com/i, "routing boundary must not special-case Atlas identity");
});

test("tenant rewrite cannot re-enter the protected internal runtime", async () => {
  const proxy = await requireSnippets("proxy.ts", [
    "function publishedSiteRewritePath",
    "`/sites/${encodeURIComponent(siteSlug)}`",
    "publishedSiteRewritePath(resolved.siteSlug, pathname)",
    'pathname === "/__sites" || pathname.startsWith("/__sites/")',
    '"/sites",',
  ]);

  assert.doesNotMatch(
    proxy,
    /rewriteUrl\.pathname\s*=\s*`\/__sites\//,
    "tenant host rewrites must never target the direct-internal route that proxy itself blocks",
  );
  assert.ok(
    proxy.indexOf("resolveSiteHostForProxy(host)") < proxy.indexOf("publishedSiteRewritePath(resolved.siteSlug, pathname)"),
    "hostname must resolve to one published site before the public runtime destination is selected",
  );
});

test("published shadow runtime remains globally unique and canonical-domain aware", async () => {
  const foundation = await requireSnippets("supabase/migrations/20260904154500_ensemblis_sites_foundation.sql", [
    "unique (slug)",
  ]);
  const runtime = await requireSnippets("lib/sites/runtime.ts", [
    '.eq("slug", slug)',
    '.eq("state", "published")',
    '.eq("is_primary", true)',
    '.eq("verification_status", "verified")',
    '.eq("ssl_status", "active")',
  ]);
  assert.ok(foundation.includes("unique (slug)"));
  assert.ok(runtime.includes("loadPublishedSiteBySlug"));
});

test("tenant SEO identity endpoints use the same non-looping published runtime", async () => {
  for (const path of [
    "app/sites/[slug]/robots.txt/route.ts",
    "app/sites/[slug]/sitemap.xml/route.ts",
    "app/sites/[slug]/manifest.webmanifest/route.ts",
    "app/sites/[slug]/favicon.ico/route.ts",
  ]) {
    await requireSnippets(path, ["loadPublishedSiteBySlug(slug)"]);
  }

  const robots = await source("app/sites/[slug]/robots.txt/route.ts");
  assert.ok(robots.includes('runtime.primaryHostname'));
  assert.ok(robots.includes('"Disallow: /"'), "unmapped shadow hosts must not be promoted as canonical crawl targets");

  const sitemap = await source("app/sites/[slug]/sitemap.xml/route.ts");
  assert.ok(sitemap.includes("runtime?.primaryHostname"));

  const favicon = await source("app/sites/[slug]/favicon.ico/route.ts");
  assert.ok(favicon.includes("status: 204"));
});

test("legacy internal host runtime still revalidates canonical hostname before rendering", async () => {
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
