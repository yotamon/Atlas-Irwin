import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RUNTIME_ROOTS = ["app", "components", "lib"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

const rules = [
  {
    name: "legacy catalog media resolver",
    pattern: /@\/lib\/catalog\/legacy-media|resolveLegacyCanvasVideoUrl/,
  },
  {
    name: "filesystem release catalog runtime import",
    pattern: /from\s+["']@\/lib\/releases["']|require\(["']@\/lib\/releases["']\)/,
  },
  {
    name: "pre-Ensemblis schema fallback",
    pattern: /isPreEnsemblisSchemaError|PGRST204[^\n]*artist_id|artist_id[^\n]*PGRST204/,
  },
];

async function collectFiles(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(relativePath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }

  return files;
}

const files = (await Promise.all(RUNTIME_ROOTS.map(collectFiles))).flat();
const violations = [];

for (const relativePath of files) {
  const content = await readFile(path.join(ROOT, relativePath), "utf8");
  for (const rule of rules) {
    if (rule.pattern.test(content)) {
      violations.push(`${relativePath}: ${rule.name}`);
    }
  }
}

if (violations.length) {
  console.error("Legacy runtime compatibility was detected:");
  for (const violation of violations) console.error(`- ${violation}`);
  console.error("\nKeep legacy migration/recovery logic under scripts/ or migration history, not runtime application code.");
  process.exit(1);
}

console.log(`Legacy runtime guard passed across ${files.length} source files.`);
