import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V5 keeps one small primary workspace model", async () => {
  const product = await source("lib/ensemblis-product.ts");
  const sidebar = await source("components/studio/sidebar.tsx");
  const mobile = await source("components/studio/mobile-navigation.tsx");

  for (const label of ["Today", "Music", "Grow"]) {
    assert.ok(product.includes(`label: "${label}"`), `missing primary workspace ${label}`);
  }
  assert.ok(product.includes("ENSEMBLIS_CREATE_ACTION"));
  assert.ok(sidebar.includes("ENSEMBLIS_WORK_NAV"));
  assert.ok(sidebar.includes("ENSEMBLIS_MANAGE_NAV"));
  assert.ok(mobile.includes("ENSEMBLIS_MOBILE_WORK_NAV"));
  assert.ok(mobile.includes('variant="mobile"'));
  assert.equal(product.includes('{ href: "/studio/create", label: "Create", icon: "content" },'), false,
    "Create must remain a global action rather than a fourth work-nav item");
});

test("Action Launcher resolves intent and artist objects instead of exposing a tool directory", async () => {
  const palette = await source("components/studio/command-palette.tsx");
  const domain = await source("lib/studio/intent/domain.ts");
  const server = await source("lib/studio/intent/server.ts");
  const endpoint = await source("app/api/studio/intent/route.ts");
  const tasks = await source("lib/ai/tasks.ts");

  for (const intent of [
    "add_music",
    "create_from_object",
    "master_track",
    "mix_music",
    "prepare_release",
    "promote_release",
    "release_readiness",
    "release_results",
    "continue_work",
    "needs_you",
    "connect_library",
  ]) assert.ok(domain.includes(`"${intent}"`), `intent registry lost ${intent}`);

  assert.ok(palette.includes("/api/studio/intent"));
  assert.ok(palette.includes("Finding the right action"));
  assert.ok(palette.includes("Understanding the request"));
  assert.ok(palette.includes("Best match"));
  assert.ok(palette.includes("Ensemblis understood"));
  assert.ok(palette.includes("emitStudioUxEvent"));
  assert.equal(palette.includes('"Do" | "Go to" | "Create" | "Tools"'), false);
  assert.equal(palette.includes("commandMatches"), false);
  assert.equal(palette.includes("Artist results"), false);

  assert.ok(server.includes("runEnsemblisAiTask"));
  assert.ok(server.includes('task: "ux.intent_resolution"'));
  assert.ok(server.includes("deriveReleaseMission"));
  assert.ok(server.includes("loadReleaseWorkspaceSnapshot"));
  assert.ok(server.includes('from("track_vault")'));
  assert.ok(server.includes('from("releases")'));
  assert.ok(server.includes('from("automix_jobs")'));
  assert.ok(endpoint.includes("resolveArtistContext"));
  assert.ok(tasks.includes('"ux.intent_resolution"'));
});

test("Today makes the launcher contextual and keeps one ranked next move", async () => {
  const today = await source("app/studio/(protected)/page.tsx");
  assert.ok(today.includes("launcherSuggestions"));
  assert.ok(today.includes("topDecision"));
  assert.ok(today.includes("primaryMission"));
  assert.ok(today.includes("latestMix"));
  assert.ok(today.includes("latestTrack"));
  assert.ok(today.includes('suggestions={launcherSuggestions}'));
  assert.ok(today.includes("<PriorityHero"));
  assert.ok(today.includes("<ContinueWidget"));
  assert.ok(today.includes("Everything else today"));
});

test("Music is an object collection instead of one stacked capability dashboard", async () => {
  const page = await source("app/studio/(protected)/music/page.tsx");
  const overview = await source("components/studio/music-workspace-overview.tsx");
  const releases = await source("app/studio/(protected)/releases/page.tsx");
  const mixes = await source("components/studio/mix-library.tsx");

  assert.ok(page.includes('searchParams: Promise<{ view?: string; q?: string }>'));
  assert.ok(overview.includes('type="search"'));
  assert.ok(overview.includes("music-v5-track-list"));
  assert.ok(overview.includes("Music that needs your attention"));
  assert.equal(overview.includes("Catalog collections"), false);
  assert.equal(overview.includes("Create with AI"), false);
  assert.equal(overview.includes("Turn the music into the next useful asset"), false);

  assert.ok(releases.includes("<ReleaseCatalog"));
  assert.ok(mixes.includes('type="search"'));
  assert.ok(mixes.includes("ContinueWidget"));
  assert.ok(mixes.includes("leftActive"));
});

test("Track is action-first and technical depth is contextual", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const inspector = await source("components/studio/context-inspector.tsx");

  assert.ok(track.includes("<ObjectActionBar"));
  for (const action of ['label: "Create"', 'label: "Master"', 'label: "Mix"']) assert.ok(track.includes(action));
  assert.ok(track.includes("<ContextInspector"));
  assert.ok(track.includes("const createHref = releaseTrack ?"));
  assert.ok(track.includes("Master or mix this unreleased track"));
  assert.ok(track.includes("track-v5-workspace"));
  assert.ok(track.includes("track-v5-secondary-details"));
  assert.ok(track.includes('id="stems"'));
  assert.ok(track.includes('id="lyrics"'));
  assert.equal(track.includes("tabs={tabs}"), false);
  assert.equal(track.includes('label: "Intelligence", href: "#intelligence"'), false);
  assert.ok(inspector.includes("<Dialog"));
  assert.ok(inspector.includes("ensemblis-context-inspector"));
});

test("Release leads with the release plan before track and engineering detail", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  const coherence = await source("components/studio/release-mastering-coherence.tsx");

  const hero = release.indexOf("release-mission-hero");
  const tracklist = release.indexOf("<ReleaseTracklist");
  assert.ok(hero >= 0 && tracklist >= 0 && hero < tracklist, "release plan must precede track machinery");
  assert.ok(release.includes("Release plan"));
  assert.ok(release.includes("Next decisions"));
  for (const stage of ["Overview", "Creative", "Promotion", "Distribution", "Results"]) {
    assert.ok(release.includes(`label: "${stage}"`));
  }
  assert.ok(coherence.includes("<details"));
  assert.ok(coherence.includes("open={needsReview"));
  assert.ok(coherence.includes("Engineering criteria"));
});

test("Create preserves object context and honors a requested deliverable", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  const outcomes = await source("lib/studio/create-outcomes.ts");

  assert.ok(create.includes("outcome?: string"));
  assert.ok(create.includes("resolveCreateOutcomeIntent"));
  assert.ok(create.includes("preferredOutcome"));
  assert.ok(create.includes("<Status>Requested</Status>"));
  assert.ok(create.includes("What do you want to make?"));
  assert.ok(outcomes.includes("resolveCreateOutcomeIntent"));
  assert.ok(outcomes.includes("reel|short|clip"));
});

test("Grow is recommendation-first before opportunities, in-motion work and metrics", async () => {
  const grow = await source("app/studio/(protected)/growth/page.tsx");
  const recommendation = grow.indexOf("growth-v5-recommendation");
  const opportunities = grow.indexOf("growth-v5-opportunities");
  const inMotion = grow.indexOf("growth-v5-in-motion");
  const evidence = grow.indexOf("growth-v5-evidence-grid");

  assert.ok(recommendation >= 0);
  assert.ok(recommendation < opportunities);
  assert.ok(opportunities < inMotion);
  assert.ok(inMotion < evidence);
  assert.ok(grow.includes("Recommended next action"));
  assert.ok(grow.includes("What is holding growth back"));
  assert.ok(grow.includes("Paid tests"));
  assert.equal(grow.includes("Run a bounded paid experiment"), false);
});

test("V5 instrumentation measures friction without storing raw launcher text", async () => {
  const client = await source("components/studio/ux-telemetry.tsx");
  const endpoint = await source("app/api/studio/ux-event/route.ts");
  const palette = await source("components/studio/command-palette.tsx");

  for (const event of ["surface_view", "launcher_opened", "launcher_resolution", "launcher_action", "primary_action", "advanced_opened"]) {
    assert.ok(endpoint.includes(`"${event}"`));
  }
  assert.ok(client.includes("sessionStorage"));
  assert.ok(client.includes("sendBeacon"));
  assert.ok(endpoint.includes("anonymousKey"));
  assert.equal(endpoint.includes("rawQuery"), false);
  assert.equal(endpoint.includes("query:"), false);
  assert.ok(palette.includes("launcher_resolution"));
  assert.ok(palette.includes("launcher_action"));
});

test("V5 keeps specialist routes contained and intentionally undiscoverable", async () => {
  const inventory = await source("docs/ensemblis-ux-v5-route-inventory.md");
  const palette = await source("components/studio/command-palette.tsx");
  for (const route of ["/studio/content", "/studio/analytics", "/studio/campaigns", "/studio/media", "/studio/data-health"]) {
    assert.ok(inventory.includes(`| ${route} |`));
  }
  for (const label of ["Campaigns", "Distribution", "Advanced Content Lab", "Data health"]) {
    assert.equal(palette.includes(`label: "${label}"`), false, `launcher must not advertise specialist destination ${label}`);
  }
});

async function pageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(absolute);
    return entry.isFile() && entry.name === "page.tsx" ? [absolute] : [];
  }));
  return nested.flat();
}

test("every protected Studio route has one V5 ownership record", async () => {
  const inventory = await source("docs/ensemblis-ux-v5-route-inventory.md");
  const root = fileURLToPath(new URL("../app/studio/(protected)/", import.meta.url));
  const pages = await pageFiles(root);
  const routes = pages.map((page) => {
    const path = relative(root, page).replaceAll("\\", "/");
    const suffix = path === "page.tsx" ? "" : path.replace(/\/page\.tsx$/, "");
    return suffix ? `/studio/${suffix}` : "/studio";
  });

  assert.ok(routes.length >= 50);
  for (const route of routes) {
    assert.ok(inventory.includes(`| ${route} |`), `V5 route inventory is missing ${route}`);
  }
});
