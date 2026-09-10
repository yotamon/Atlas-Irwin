import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("Windows Library Bridge resource icon is generated deterministically from canonical Ensemblis artwork", async () => {
  const cargo = await source("apps/library-bridge/src-tauri/Cargo.toml");
  const build = await source("apps/library-bridge/src-tauri/build.rs");

  assert.ok(cargo.includes('ico = "=0.5.0"'));
  assert.ok(cargo.includes('image = { version = "=0.25.10", default-features = false, features = ["png"] }'));
  assert.ok(build.includes("../../../public/android-chrome-512x512.png"));
  assert.ok(build.includes("[32u32, 16, 24, 48, 64, 256]"));
  assert.ok(build.includes('std::env::var("OUT_DIR")'));
  assert.ok(build.includes("window_icon_path(generated_windows_icon())"));
  assert.equal(build.includes('icons/icon.ico'), false, "Windows builds must not depend on an untracked source-tree ICO");
});
