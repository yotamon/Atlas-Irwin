import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V4 makes intent discovery a first-class product surface", async () => {
  const palette = await source("components/studio/command-palette.tsx");
  const today = await source("app/studio/(protected)/page.tsx");

  assert.ok(palette.includes('"Do" | "Go to" | "Create" | "Tools"'));
  assert.ok(palette.includes('"Make a DJ mix"'));
  assert.ok(palette.includes('"Add music"'));
  assert.ok(palette.includes('"Connect my music library"'));
  assert.ok(palette.includes('"Prepare a release"'));
  assert.ok(palette.includes('variant?: "compact" | "launcher"'));
  assert.ok(palette.includes("What do you want to do?"));
  assert.ok(palette.includes("commandMatches"));
  assert.ok(palette.includes("INTENT_STOP_WORDS"));
  assert.ok(palette.includes('? ["Do"]'));
  assert.ok(today.includes('<CommandPalette artistId={artist.artistId} variant="launcher"'));
  assert.ok(today.includes("<ContinueWidget"));
  const mobile = await source("components/studio/mobile-navigation.tsx");
  assert.ok(mobile.includes('<CommandPalette artistId={artistId} variant="mobile" />'));
});

test("Music treats Tracks, Releases and Mixes as coherent objects", async () => {
  const nav = await source("components/studio/music-library-nav.tsx");
  const music = await source("app/studio/(protected)/music/page.tsx");
  const mixes = await source("components/studio/mix-library.tsx");

  assert.ok(nav.includes('"tracks" | "releases" | "mixes"'));
  assert.ok(nav.includes("Mixes"));
  assert.ok(music.includes('if (view === "mixes")'));
  assert.ok(music.includes("<MixLibrary"));
  assert.ok(mixes.includes("root_job_id"));
  assert.ok(mixes.includes("<ContinueWidget"));
  assert.ok(mixes.includes("New mix"));
});

test("Track objects expose actions where the music already lives", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const widgets = await source("components/studio/ux-v4-widgets.tsx");

  assert.ok(track.includes("<ObjectActionBar"));
  assert.ok(track.includes('label: "Create"'));
  assert.ok(track.includes('label: "Master"'));
  assert.ok(track.includes('label: "Mix"'));
  assert.ok(widgets.includes("export function ObjectActionBar"));
  assert.ok(widgets.includes("export function InsightWidget"));
  assert.ok(widgets.includes("export function ConnectionWidget"));
});

test("global object search includes resumable Mix objects", async () => {
  const search = await source("app/api/studio/search/route.ts");
  assert.ok(search.includes('from("automix_jobs")'));
  assert.ok(search.includes("mixRoot"));
  assert.ok(search.includes('type: "Mix"'));
  assert.ok(search.includes("/studio/music/automix?mix="));
  assert.ok(search.includes("mixSource(mix)"));
});

test("V4 widgets remain compositions on top of the canonical Design System", async () => {
  const widgets = await source("components/studio/ux-v4-widgets.tsx");
  const css = await source("app/studio/design-system/workflows.css");
  assert.ok(widgets.includes('from "@/components/studio/ui"'));
  for (const selector of [
    ".ensemblis-action-launcher-trigger",
    ".en-continue-widget",
    ".en-object-action-bar",
    ".en-connection-widget",
    ".en-workflow-stepper",
  ]) assert.ok(css.includes(selector), `missing V4 composition ${selector}`);
  assert.equal(css.includes("--en-success"), false, "V4 must only use defined Ensemblis tokens");
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

test("every protected Studio route is owned by the V4 inventory", async () => {
  const inventory = await source("docs/ensemblis-ux-v4-route-inventory.md");
  const root = fileURLToPath(new URL("../app/studio/(protected)/", import.meta.url));
  const pages = await pageFiles(root);
  const routes = pages.map((page) => {
    const path = relative(root, page).replaceAll("\\", "/");
    const suffix = path === "page.tsx" ? "" : path.replace(/\/page\.tsx$/, "");
    return suffix ? `/studio/${suffix}` : "/studio";
  });

  assert.ok(routes.length >= 50, "route inventory test unexpectedly found too few Studio pages");
  for (const route of routes) {
    assert.ok(inventory.includes(`| ${route} |`), `V4 route inventory is missing ${route}`);
  }
});
