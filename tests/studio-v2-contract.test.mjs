import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const requiredRoutes = [
  "app/studio/(protected)/page.tsx",
  "app/studio/(protected)/releases/page.tsx",
  "app/studio/(protected)/create/page.tsx",
  "app/studio/(protected)/library/page.tsx",
  "app/studio/(protected)/settings/page.tsx",
  "app/studio/(protected)/production/page.tsx",
  "app/studio/(protected)/learn/page.tsx",
  "app/studio/(protected)/inbox/page.tsx",
];

test("Studio V2 keeps every daily outcome route present", async () => {
  await Promise.all(requiredRoutes.map((path) => access(path)));
});

test("primary navigation stays intentionally small", async () => {
  const sidebar = await readFile("components/studio/sidebar.tsx", "utf8");
  for (const route of ["/studio", "/studio/releases", "/studio/create", "/studio/library", "/studio/settings"]) {
    assert.match(sidebar, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const advancedRoute of ["/studio/campaigns", "/studio/content", "/studio/outreach", "/studio/analytics", "/studio/data-health"]) {
    assert.equal(sidebar.includes(`\"${advancedRoute}\"`), false, `${advancedRoute} leaked back into the primary navigation`);
  }
});

test("release workspace exposes outcome stages and preserves an advanced escape hatch", async () => {
  const workspace = await readFile("components/studio/release-workspace-v2.tsx", "utf8");
  for (const stage of ["Overview", "Plan", "Create", "Publish", "Learn"]) assert.ok(workspace.includes(stage));
  assert.ok(workspace.includes("Advanced view"));
  assert.ok(workspace.includes("/studio/production"));
});

test("normal Studio V2 routes do not link daily work back to Content Lab", async () => {
  const files = [
    "app/studio/(protected)/page.tsx",
    "app/studio/(protected)/calendar/page.tsx",
    "components/studio/release-workspace-v2.tsx",
  ];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.equal(source.includes("/studio/content?edit="), false, `${path} still routes normal edits through Content Lab`);
  }
});
