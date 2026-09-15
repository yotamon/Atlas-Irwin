import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const retiredFiles = [
  "lib/catalog/legacy-media.ts",
  "lib/releases.ts",
];
const retiredScripts = [
  "import-legacy-releases.mjs",
  "import-public-releases.mjs",
  "migrate-media-to-public.mjs",
];
const runtimeRoots = ["app", "components", "lib"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const violations = [];

for (const relativePath of retiredFiles) {
  if (existsSync(path.join(root, relativePath))) {
    violations.push(`${relativePath}: retired compatibility file still exists`);
  }
}

for (const runtimeRoot of runtimeRoots) {
  const directory = path.join(root, runtimeRoot);
  if (!existsSync(directory)) continue;

  for (const file of walk(directory)) {
    if (!extensions.has(path.extname(file))) continue;
    const relativePath = path.relative(root, file).split(path.sep).join("/");
    if (relativePath === "lib/releases/types.ts") continue;

    const source = readFileSync(file, "utf8");
    if (/public[\\/]+releases/i.test(source)) {
      violations.push(`${relativePath}: references retired public/releases runtime storage`);
    }
    if (/resolveLegacyCanvasVideoUrl/.test(source)) {
      violations.push(`${relativePath}: references retired Canvas fallback`);
    }
    if (/(?:from|import\()[^\n]*["']@\/lib\/releases["']/.test(source)) {
      violations.push(`${relativePath}: imports retired filesystem catalog reader`);
    }
  }
}

const packageJson = readFileSync(path.join(root, "package.json"), "utf8");
for (const script of retiredScripts) {
  if (packageJson.includes(script)) {
    violations.push(`package.json: references retired script ${script}`);
  }
}

if (violations.length) {
  console.error("Filesystem catalog compatibility check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Filesystem catalog compatibility check passed.");
