import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Shot Inspector remounts when the selected shot changes canonically without syncing props through an effect", async () => {
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");

  assert.match(editor, /const inspectorKey = selectedShot/);
  assert.match(editor, /selectedShot\.prompt_version/);
  assert.match(editor, /selectedShot\.shot_type/);
  assert.match(editor, /selectedShot\.selected_asset_id/);
  assert.match(editor, /selectedShot\.character_id/);
  assert.match(editor, /<ShotInspector key=\{inspectorKey\}/);

  const inspector = editor.slice(editor.indexOf("function ShotInspector"), editor.indexOf("export function VideoDirectorProEditor"));
  assert.doesNotMatch(inspector, /useEffect\(/);
});
