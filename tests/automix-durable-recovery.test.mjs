import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("media-worker heartbeat gives idle capacity to durable AutoMix jobs", async () => {
  const route = await source("app/api/cron/media-worker/route.ts");

  assert.ok(route.includes('import { kickAutoMixQueue } from "@/lib/automix/jobs"'));
  assert.ok(route.includes("const mediaWorker = await kickMediaWorkerQueue()"));
  assert.ok(route.includes('mediaWorker.dispatched || mediaWorker.reason === "busy"'));
  assert.ok(route.includes("await kickAutoMixQueue()"));
  assert.ok(route.includes("queue: { mediaWorker, automix }"));
});
