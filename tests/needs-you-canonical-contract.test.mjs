import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Today and the full Needs You page render one canonical queue", async () => {
  const [today, queuePage, snapshot] = await Promise.all([
    source("app/studio/(protected)/page.tsx"),
    source("app/studio/(protected)/needs-you/page.tsx"),
    source("lib/studio/artist-operating-snapshot.ts"),
  ]);

  assert.ok(today.includes("loadArtistOperatingSnapshot"));
  assert.ok(queuePage.includes("loadArtistOperatingSnapshot"));
  assert.ok(queuePage.includes("const queue = snapshot.needsYou"));
  assert.ok(snapshot.includes("deriveNeedsYouQueue"));

  assert.equal(queuePage.includes("deriveNeedsYouQueue"), false, "The full queue must not rebuild the universal projection");
  assert.equal(queuePage.includes('.from("'), false, "The full queue must not own a second database query stack");
  assert.equal(queuePage.includes("loadDistributionArtistState"), false, "Distribution decisions must enter through the shared snapshot");
  assert.equal(queuePage.includes("loadPaidGrowthWorkspace"), false, "Paid Growth decisions must enter through the shared snapshot");
  assert.equal(snapshot.includes("}).slice(0, 7)"), false, "The canonical queue must not truncate itself for Today's preview needs");
});

test("Needs You decisions preserve source lineage, affected Mission and timing metadata", async () => {
  const [projection, snapshot, queuePage] = await Promise.all([
    source("lib/studio/needs-you.ts"),
    source("lib/studio/artist-operating-snapshot.ts"),
    source("app/studio/(protected)/needs-you/page.tsx"),
  ]);

  for (const field of ["source:", "missionId:", "deadlineAt:", "freshnessAt:", "label:"]) {
    assert.ok(projection.includes(field), `Needs You projection is missing ${field}`);
  }
  assert.ok(projection.includes("export type NeedsYouTiming"));
  assert.ok(projection.includes("timing: NeedsYouTiming"));
  assert.ok(projection.includes("timing: missionTiming(input)"));
  assert.ok(projection.includes("deadlineAt: publication.scheduledAt ?? null"));
  assert.ok(projection.includes("deadlineAt: asset.scheduledAt ?? null"));
  assert.ok(projection.includes("deadlineAt: task.dueAt ?? null"));

  assert.ok(snapshot.includes("activeReleaseDate: activeRelease?.release_date ?? null"));
  assert.ok(snapshot.includes("activeReleaseDateLabel:"));
  assert.ok(snapshot.includes("scheduledAt: job.scheduled_at"));
  assert.ok(snapshot.includes("scheduledAt: item.scheduled_at"));
  assert.ok(snapshot.includes("dueAt: task.due_at"));
  assert.ok(queuePage.includes("entry.timing.label"), "The full queue should expose useful timing context when available");
});

test("Needs You stays a projection rather than a second task database", async () => {
  const projection = await source("lib/studio/needs-you.ts");
  assert.equal(projection.includes(".from("), false);
  assert.equal(projection.includes(".insert("), false);
  assert.equal(projection.includes(".update("), false);
  assert.equal(projection.includes(".delete("), false);
});
