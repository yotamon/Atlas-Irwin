import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Director Pro manual source palette shows visual sources instead of audio or internal render artifacts", async () => {
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");

  assert.match(editor, /function isVisualAsset/);
  assert.match(editor, /mime\.startsWith\("image\/"\)/);
  assert.match(editor, /const renderAssetIds = new Set/);
  assert.match(editor, /asset\.asset_type !== "thumbnail"/);
  assert.match(editor, /!renderAssetIds\.has\(asset\.id\)/);
  assert.match(editor, /sourceAssets\.map/);
  assert.match(editor, /visual assets/);
  assert.doesNotMatch(editor, /\{data\.assets\.map\(\(asset\)/);
});
