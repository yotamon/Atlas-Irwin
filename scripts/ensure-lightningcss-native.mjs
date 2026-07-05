import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function platformTarget() {
  const parts = [process.platform, process.arch];
  if (process.platform === "win32") {
    parts.push("msvc");
  }
  return parts.join("-");
}

function readPackageVersion(relativePath) {
  const packageJsonPath = join(root, relativePath);
  return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

function fetchNativeFromNpm(packageName, version, fileName) {
  const tarball = execSync(`npm pack ${packageName}@${version}`, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .split("\n")
    .at(-1)
    ?.trim();

  if (!tarball) {
    return null;
  }

  execSync(`tar -xf ${JSON.stringify(tarball)}`, { cwd: root, stdio: "ignore" });
  const extracted = join(root, "package", fileName);
  const result = existsSync(extracted) ? extracted : null;

  try {
    execSync(`rm -rf ${JSON.stringify(join(root, "package"))}`, { cwd: root, stdio: "ignore" });
  } catch {
    // Windows fallback
    try {
      execSync(`Remove-Item -Recurse -Force ${JSON.stringify(join(root, "package"))}`, {
        cwd: root,
        stdio: "ignore",
        shell: "powershell.exe",
      });
    } catch {
      // best effort cleanup
    }
  }

  try {
    execSync(`rm -f ${JSON.stringify(join(root, tarball))}`, { cwd: root, stdio: "ignore" });
  } catch {
    try {
      execSync(`Remove-Item -Force ${JSON.stringify(join(root, tarball))}`, {
        cwd: root,
        stdio: "ignore",
        shell: "powershell.exe",
      });
    } catch {
      // best effort cleanup
    }
  }

  return result;
}

function resolveNativeSource(packageName, fileName, version) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const candidate = join(dirname(packageJsonPath), fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // Optional platform package may be missing when npm and Node CPU targets differ.
  }

  return fetchNativeFromNpm(packageName, version, fileName);
}

function ensureNativeBinding({
  packageName,
  hostDir,
  fileName,
  version,
}) {
  const targetPath = join(root, hostDir, fileName);
  if (existsSync(targetPath)) {
    return;
  }

  const sourcePath = resolveNativeSource(packageName, fileName, version);
  if (!sourcePath) {
    return;
  }

  mkdirSync(join(root, hostDir), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function ensureNativeBindings() {
  const target = platformTarget();

  ensureNativeBinding({
    packageName: `lightningcss-${target}`,
    hostDir: "node_modules/lightningcss",
    fileName: `lightningcss.${target}.node`,
    version: readPackageVersion("node_modules/lightningcss/package.json"),
  });

  ensureNativeBinding({
    packageName: `@tailwindcss/oxide-${target}`,
    hostDir: "node_modules/@tailwindcss/oxide",
    fileName: `tailwindcss-oxide.${target}.node`,
    version: readPackageVersion("node_modules/@tailwindcss/oxide/package.json"),
  });
}

ensureNativeBindings();
