import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Artist Memory is structured, source-backed and bounded by consumer", async () => {
  const domain = await source("lib/artist-memory/domain.ts");
  for (const snippet of [
    '"identity"',
    '"creative_rule"',
    '"preference_evidence"',
    '"performance_learning"',
    '"strategic_constraint"',
    '"provenance_compliance"',
    'kind: "brand_setting" | "creative_memory" | "moment_calibration" | "verified_learning"',
    "consumers: ArtistMemoryConsumer[]",
    'label: "explicit"',
    'lifecycle: input.expired ? "expired" : "active"',
  ]) assert.ok(domain.includes(snippet), `Artist Memory contract is missing ${snippet}`);
  assert.equal(domain.includes("chat_history"), false, "Artist Memory must not become opaque chat history");
});

test("Artist Memory aggregation remains artist-scoped and uses existing evidence systems", async () => {
  const server = await source("lib/artist-memory/server.ts");
  assert.ok(server.includes('from("brand_settings")'));
  assert.ok(server.includes('from("marketing_learnings")'));
  assert.ok(server.includes("loadArtistCreativeMemory"));
  assert.ok(server.match(/\.eq\("artist_id", input\.artistId\)/g)?.length >= 2, "canonical DB reads must carry artist scope");
  assert.ok(server.match(/\.eq\("owner_id", input\.ownerId\)/g)?.length >= 2, "canonical DB reads must carry owner scope");
});

test("Artist-facing Memory explains why Ensemblis believes a rule", async () => {
  const page = await source("app/studio/(protected)/memory/page.tsx");
  for (const snippet of [
    'title="Artist Memory"',
    "Why Ensemblis believes what it believes",
    "Source:",
    "Allowed consumers:",
    "Memory is evidence, not chat history",
    "Open source",
  ]) assert.ok(page.includes(snippet), `Artist Memory surface is missing ${snippet}`);
});

test("Needs You is a projection over canonical state rather than a second task system", async () => {
  const domain = await source("lib/studio/needs-you.ts");
  const page = await source("app/studio/(protected)/needs-you/page.tsx");
  assert.ok(domain.includes("deriveNeedsYouQueue"));
  assert.ok(domain.includes("input.activeMission?.blockers"));
  assert.ok(domain.includes('severity: "required"'));
  assert.ok(domain.includes('source: { kind: "mission"'));
  assert.ok(page.includes("<DecisionQueue"));
  assert.ok(page.includes("Blocking decisions"));
  assert.ok(page.includes("Everything else"));
  assert.equal(page.includes("second task system"), false, "internal projection architecture should not be exposed as artist-facing copy");
  assert.equal(page.includes("One queue, no duplicate tasks"), false, "internal dedupe architecture should not compete with decisions");
  assert.equal(domain.includes("completed: boolean"), false, "Needs You items must not own duplicate completion state");
});

test("Today is a thin Manager renderer over one canonical operating snapshot", async () => {
  const today = await source("app/studio/(protected)/page.tsx");
  const snapshot = await source("lib/studio/artist-operating-snapshot.ts");
  assert.ok(today.includes("loadArtistOperatingSnapshot"));
  assert.ok(today.includes('href={href("/studio/needs-you")}'));
  assert.ok(today.includes("needsYouTone(item)"));
  assert.ok(today.includes("Recommended next move"));
  assert.ok(today.includes('topDecision.severity === "required" ? "Required" : "Needs attention"'));
  assert.ok(today.includes("Ensemblis is handling"));
  assert.equal(today.includes("Artist operating mode"), false, "configuration belongs to Settings, not the everyday manager loop");
  assert.equal(today.includes('from("releases")'), false, "Today page should not own cross-domain data fan-out");
  assert.ok(snapshot.includes("deriveNeedsYouQueue"));
  assert.ok(snapshot.includes("deriveReleaseMission"));
  assert.ok(snapshot.includes("loadDistributionArtistState"));
  assert.ok(snapshot.includes("loadPaidGrowthWorkspace"));
  assert.ok(snapshot.includes("loadWorkspaceOperatingPreferences"));
  assert.ok(snapshot.includes("topDecision: needsYou[0] ?? null"));
  assert.equal(snapshot.includes("/100 signal"), false, "Manager should not expose pseudo-precise ranking scores as artist truth");
});

test("primary navigation exposes durable workspaces while releases and create stay contextual", async () => {
  const product = await source("lib/ensemblis-product.ts");
  const sidebar = await source("components/studio/sidebar.tsx");
  const contextBar = await source("components/studio/context-bar.tsx");
  const grow = await source("app/studio/(protected)/growth/page.tsx");
  const settings = await source("app/studio/(protected)/settings/page.tsx");
  const release = await source("components/studio/release-workspace-v2.tsx");
  const musicNav = await source("components/studio/music-library-nav.tsx");
  const mobileNav = await source("components/studio/mobile-navigation.tsx");
  const workStart = product.indexOf("export const ENSEMBLIS_WORK_NAV");
  const createStart = product.indexOf("export const ENSEMBLIS_CREATE_ACTION");
  const moreStart = product.indexOf("export const ENSEMBLIS_MORE_NAV");
  const mobileMoreStart = product.indexOf("export const ENSEMBLIS_MOBILE_MORE_NAV");
  const workSource = product.slice(workStart, createStart);
  const moreSource = product.slice(moreStart, mobileMoreStart);

  for (const label of ["Today", "Music", "Grow"]) assert.ok(workSource.includes(`label: "${label}"`));
  for (const label of ["Releases", "Create", "Audience", "Library", "Memory", "Sites", "Distribution", "Connections"]) assert.equal(workSource.includes(`label: "${label}"`), false, `${label} must not compete in primary navigation`);
  assert.ok(product.includes('ENSEMBLIS_CREATE_ACTION'));
  assert.ok(product.includes('label: "Create"'));
  assert.ok(product.includes('{ prefix: "/studio/releases", area: "Music", parentHref: "/studio/music" }'));
  assert.ok(musicNav.includes("Releases"));
  assert.ok(musicNav.includes('ensemblisArtistHref("/studio/releases", artistId)'));
  for (const label of ["Library", "Sites"]) assert.ok(moreSource.includes(`label: "${label}"`), `${label} remains a cross-workflow utility`);
  for (const label of ["Audience", "Memory", "Distribution", "Connections"]) assert.equal(moreSource.includes(`label: "${label}"`), false, `${label} must be owned by its parent workflow rather than More`);

  assert.ok(grow.includes('label: "Audience"'));
  assert.ok(settings.includes("Artist Memory"));
  assert.ok(settings.includes("Connections"));
  assert.ok(release.includes('"Distribution"'));
  assert.ok(sidebar.includes('studio-sidebar-section-label">More'));
  assert.ok(sidebar.includes("<StudioPrimaryNavigation items={moreNavigation}"));
  assert.ok(contextBar.includes('href={ensemblisArtistHref("/studio/needs-you", artistId)}'));
  assert.ok(mobileNav.includes("resolveEnsemblisRouteContext(pathname)"));
  assert.ok(mobileNav.includes("context.parentHref === item.href"));
  assert.equal(product.includes('{ href: "/studio/needs-you", label:'), false, "Needs You should stay a decision surface rather than another primary destination");
});
