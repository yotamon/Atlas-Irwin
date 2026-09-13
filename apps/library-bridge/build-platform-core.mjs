import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const bridgeRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(bridgeRoot, "../..");
const outputPath = join(bridgeRoot, "ui", "platform-core.js");

const modules = [
  ["./recordings", "lib/platform/recordings.ts"],
  ["./projects", "lib/platform/projects.ts"],
  ["./sync", "lib/platform/sync.ts"],
];

function compile(relativePath) {
  const source = readFileSync(join(repoRoot, relativePath), "utf8");
  const result = ts.transpileModule(source, {
    fileName: relativePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      removeComments: false,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n"),
    );
  }
  return result.outputText.trimEnd();
}

const output = [
  "// GENERATED FILE. Source of truth: lib/platform/{recordings,projects,sync}.ts",
  "// Regenerate with: node apps/library-bridge/build-platform-core.mjs",
  "(() => {",
  "  'use strict';",
  "  const modules = Object.create(null);",
];

for (const [id, relativePath] of modules) {
  const compiled = compile(relativePath)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  output.push(
    "  {",
    "    const module = { exports: {} };",
    "    const exports = module.exports;",
    "    const require = (request) => {",
    "      const resolved = modules[request];",
    "      if (!resolved) throw new Error(`Unknown Ensemblis platform-core module: ${request}`);",
    "      return resolved;",
    "    };",
    compiled,
    `    modules[${JSON.stringify(id)}] = module.exports;`,
    "  }",
  );
}

output.push(
  "  const projects = modules['./projects'];",
  "  const sync = modules['./sync'];",
  "  window.EnsemblisPlatformCore = Object.freeze({",
  "    createProjectManifest: projects.createProjectManifest,",
  "    parsePortableProjectManifest: projects.parsePortableProjectManifest,",
  "    createProjectMutation: sync.createProjectMutation,",
  "    applyProjectMutation: sync.applyProjectMutation,",
  "    projectMutationTarget: sync.projectMutationTarget,",
  "  });",
  "})();",
  "",
);

writeFileSync(outputPath, output.join("\n"), "utf8");
console.log(`Generated ${outputPath}`);
