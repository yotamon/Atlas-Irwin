import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/auth/studio-return-path.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
});
const { studioReturnPath } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("marketing resumes the actual track-import route", () => {
  assert.equal(
    studioReturnPath("/studio/music/import"),
    "/studio/music/import",
  );
});
test("untrusted return destinations cannot escape the Studio default", () => {
  for (const input of [
    undefined,
    null,
    "",
    [],
    "/studio",
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/studio/music/import?next=https://example.com",
    "/studio/music/import/../admin",
    "%2Fstudio%2Fmusic%2Fimport",
    "/studio/music/import\r\nLocation:https://example.com",
  ]) {
    assert.equal(studioReturnPath(input), "/studio", JSON.stringify(input));
  }
});
