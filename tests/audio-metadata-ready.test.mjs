import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("lib/audio/metadata-ready.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { metadataReady } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

class AudioSource extends EventTarget {
  static HAVE_METADATA = 1;
  static NETWORK_LOADING = 2;
  readyState = 0;
  networkState = 0;
  preload = "none";
  loads = 0;

  load() {
    this.loads += 1;
    this.networkState = AudioSource.NETWORK_LOADING;
  }
}

function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "HTMLMediaElement");
  Object.defineProperty(globalThis, "HTMLMediaElement", { configurable: true, value: AudioSource });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "HTMLMediaElement", previous);
    else delete globalThis.HTMLMediaElement;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const audio = new AudioSource();
  const controller = new AbortController();
  const assertClean = () => {
    assert.equal(getEventListeners(audio, "loadedmetadata").length, 0);
    assert.equal(getEventListeners(audio, "error").length, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  };
  return { audio, controller, assertClean };
}

test("ready metadata does not reload the source or subscribe to events", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  audio.readyState = AudioSource.HAVE_METADATA;
  await metadataReady(audio, controller.signal);
  assert.equal(audio.loads, 0);
  assertClean();
});

test("metadata loads on demand and success cleans up listeners", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  const pending = metadataReady(audio, controller.signal);
  assert.equal(audio.loads, 1);
  assert.equal(audio.preload, "metadata");
  audio.dispatchEvent(new Event("loadedmetadata"));
  await pending;
  assertClean();
  t.mock.timers.tick(10000);
});

test("a failed source rejects and removes every listener", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  const pending = metadataReady(audio, controller.signal);
  audio.dispatchEvent(new Event("error"));
  await assert.rejects(pending, /could not be loaded/);
  assertClean();
});

test("a stalled source times out without retaining event listeners", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  const pending = metadataReady(audio, controller.signal);
  t.mock.timers.tick(10000);
  await assert.rejects(pending, /too long/);
  assertClean();
});

test("cancellation rejects immediately and a late load cannot revive it", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  const pending = metadataReady(audio, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assertClean();
  audio.dispatchEvent(new Event("loadedmetadata"));
});

test("an already cancelled request never starts loading", (t) => {
  const { audio, controller, assertClean } = fixture(t);
  controller.abort();
  assert.throws(() => metadataReady(audio, controller.signal), { name: "AbortError" });
  assert.equal(audio.loads, 0);
  assertClean();
});

test("a superseding request reuses the source download", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  const first = metadataReady(audio, controller.signal);
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assertClean();
  const next = new AbortController();
  const second = metadataReady(audio, next.signal);
  assert.equal(audio.loads, 1);
  audio.dispatchEvent(new Event("loadedmetadata"));
  await second;
  assert.equal(getEventListeners(next.signal, "abort").length, 0);
  assertClean();
});

test("a synchronous load failure also releases listeners", async (t) => {
  const { audio, controller, assertClean } = fixture(t);
  audio.load = () => { throw new Error("Unavailable source"); };
  await assert.rejects(metadataReady(audio, controller.signal), /Unavailable source/);
  assertClean();
});
