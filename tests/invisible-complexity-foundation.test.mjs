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
    'kind: "brand_setting" | "creative_memory" | "verified_learning"',
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
  assert.ok(page.includes("The queue is derived from source state rather than maintained as a second task system."));
  assert.ok(page.includes("One queue, no duplicate tasks"));
  assert.equal(domain.includes("completed: boolean"), false, "Needs You items must not own duplicate completion state");
});

test("Today consumes the same canonical Needs You projection and avoids pseudo-precise recommendation scores", async () => {
  const today = await source("app/studio/(protected)/page.tsx");
  assert.ok(today.includes('import { deriveNeedsYouQueue, needsYouTone } from "@/lib/studio/needs-you"'));
  assert.ok(today.includes("const needsYou = deriveNeedsYouQueue({"));
  assert.ok(today.includes('href={href("/studio/needs-you")}'));
  assert.ok(today.includes("needsYouTone(item)"));
  assert.ok(today.includes("Recommended next move"));
  assert.ok(today.includes("const topDecision = needsYou[0] ?? null"));
  assert.ok(today.includes('topDecision.severity === "required" ? "Required" : "Needs attention"'));
  assert.ok(today.includes('? "Recommended"'));
  assert.ok(today.includes(': "Clear"'));
  assert.equal(today.includes("const needsYou: TodayItem[]"), false, "Today must not maintain its own parallel decision queue");
  assert.equal(today.includes("/100 signal"), false, "Today should not expose pseudo-precise ranking scores as artist truth");
});

test("work navigation stays quiet while Needs You and Memory remain accessible", async () => {
  const product = await source("lib/ensemblis-product.ts");
  const sidebar = await source("components/studio/sidebar.tsx");
  for (const label of ["Today", "Music", "Releases", "Create", "Grow", "Audience", "Library"]) {
    assert.ok(product.includes(`label: "${label}"`));
  }
  assert.ok(product.includes('{ href: "/studio/memory", label: "Memory"'));
  assert.ok(sidebar.includes('href={ensemblisArtistHref("/studio/needs-you", artistId)}'));
  assert.ok(sidebar.includes("Needs You"));
  assert.equal(product.includes('{ href: "/studio/needs-you", label:'), false, "Needs You should not add an eighth primary work-navigation item");
});
