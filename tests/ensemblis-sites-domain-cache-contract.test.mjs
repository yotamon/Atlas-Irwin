import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("published content may cache while primary domain identity stays request-current", async () => {
  const runtime = await source("lib/sites/runtime.ts");

  for (const snippet of [
    "type PublishedSiteRuntimeCore = Omit<PublishedSiteRuntime, \"primaryHostname\">",
    "async function loadPrimaryHostnameUncached",
    "async function attachCurrentPrimaryHostname",
    "const runtime = await loadPublishedSiteCoreById(siteId)",
    "return attachCurrentPrimaryHostname(runtime)",
    '.eq("is_primary", true)',
    '.eq("verification_status", "verified")',
    '.eq("ssl_status", "active")',
  ]) {
    assert.ok(runtime.includes(snippet), `runtime must retain domain-cache coherence contract: ${snippet}`);
  }

  assert.ok(
    runtime.indexOf("const runtime = await loadPublishedSiteCoreById(siteId)") <
      runtime.indexOf("return attachCurrentPrimaryHostname(runtime)"),
    "cached site content must receive current primary hostname only after the content cache resolves",
  );

  assert.doesNotMatch(
    runtime,
    /\["ensemblis-site-host",\s*normalized\]/,
    "verified hostname ownership must not remain stale behind a published-runtime cache key",
  );
});

test("canonical metadata prefers the verified primary hostname root", async () => {
  const seo = await source("lib/sites/seo.ts");

  assert.ok(seo.includes("runtime.primaryHostname"));
  assert.ok(seo.includes("`https://${runtime.primaryHostname}`"));
  assert.ok(seo.includes("alternates: { canonical }"));
  assert.ok(seo.includes("url: canonical"));
  assert.ok(
    seo.indexOf("runtime.primaryHostname") < seo.indexOf("`${getSiteUrl()}/sites/${runtime.site.slug}`"),
    "managed shadow URL must only be the fallback when no verified primary hostname exists",
  );
});
