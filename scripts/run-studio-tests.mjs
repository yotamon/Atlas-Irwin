import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = join(root, "tests");
const testFiles = readdirSync(testsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => relative(root, join(testsDirectory, entry.name)))
  .sort();

if (!testFiles.length) {
  console.error("No Studio contract tests were discovered in tests/*.test.mjs.");
  process.exit(1);
}

console.log(`Running ${testFiles.length} discovered Studio contract tests.`);
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
