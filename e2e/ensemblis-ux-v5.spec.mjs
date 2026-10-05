import { test, expect } from "@playwright/test";

const enabled = process.env.PLAYWRIGHT_STUDIO_E2E === "1";
const email = (process.env.STUDIO_E2E_EMAIL || process.env.STUDIO_ADMIN_EMAILS?.split(",")[0] || "").trim();
const password = process.env.STUDIO_E2E_PASSWORD || process.env.STUDIO_PASSWORD || "";

function escapeRegex(value) {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
}

async function openStudio(page, path = "/studio") {
  await page.goto(path);

  if (new URL(page.url()).pathname === "/studio/login") {
    if (!email || !password) {
      throw new Error(
        "Studio E2E reached the real login screen but no credentials are configured. "
        + "Set STUDIO_E2E_EMAIL/STUDIO_E2E_PASSWORD (or the legacy Studio equivalents).",
      );
    }

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.pathname !== "/studio/login");
  }

  await expect(page).not.toHaveURL(/\/studio\/login/);
}


async function auditCheckpoint(page, name) {
  const image = await page.screenshot({ fullPage: true });
  await test.info().attach(`ux-${name}`, {
    body: image,
    contentType: "image/png",
  });
}

async function firstPlayableCatalogTrack(page) {
  await openStudio(page, "/studio/music");
  const rows = page.locator(".music-v5-track-row");
  const count = await rows.count();

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const releaseLabel = (await row.locator(".music-v5-track-identity small").textContent())?.trim();
    const playable = await row.getByRole("button", { name: /^Play / }).count();
    if (releaseLabel && releaseLabel !== "Unreleased" && playable) {
      const title = (await row.locator(".music-v5-track-identity strong").textContent())?.trim();
      const href = await row.getByRole("link", { name: "Open" }).getAttribute("href");
      if (title && href) return { title, href };
    }
  }

  throw new Error("Studio E2E requires at least one playable catalog track.");
}

async function firstRelease(page) {
  await openStudio(page, "/studio/releases");
  const release = page.locator(".release-catalog-row").first();
  await expect(release).toBeVisible();
  const title = (await release.locator(".release-catalog-copy strong").textContent())?.trim();
  const href = await release.getAttribute("href");
  if (!title || !href) throw new Error("Studio E2E requires at least one release.");
  return { title, href };
}


async function firstReleaseWithArtwork(page) {
  await openStudio(page, "/studio/releases");
  const releases = page.locator(".release-catalog-row");
  const count = await releases.count();
  for (let index = 0; index < count; index += 1) {
    const release = releases.nth(index);
    if (!(await release.locator(".release-catalog-artwork img").count())) continue;
    const title = (await release.locator(".release-catalog-copy strong").textContent())?.trim();
    const href = await release.getAttribute("href");
    if (title && href) return { title, href };
  }
  throw new Error("Studio E2E requires at least one release with artwork.");
}

async function queryLauncher(page, query) {
  await openStudio(page, "/studio");
  await page.getByRole("button", { name: "Tell Ensemblis what you want to do" }).click();
  const input = page.getByRole("textbox", { name: "Tell Ensemblis what you want to do" });
  await input.fill(query);
  await expect(page.getByText("Finding the right action…")).toBeHidden({ timeout: 15_000 });
}

test.describe("Ensemblis UX V5 authenticated acceptance", () => {
  test.skip(!enabled, "Set PLAYWRIGHT_STUDIO_E2E=1 to run the authenticated V5 acceptance suite.");

  test("launcher answers what should I work on today with one best next move", async ({ page }) => {
    await queryLauncher(page, "what should I work on today?");

    await expect(page.getByText("Best next move", { exact: true }).first()).toBeVisible();
    const bestMove = page.getByRole("link").filter({ has: page.getByText("Best next move", { exact: true }) }).first();
    await expect(bestMove).toBeVisible();
  });

  test("1. new music starts from one understandable intake choice", async ({ page }) => {
    await openStudio(page, "/studio/music?view=add");

    await expect(page.getByRole("heading", { name: "Add music" })).toBeVisible();
    await auditCheckpoint(page, "01-add-music");
    await expect(page.getByRole("link", { name: /Add a mastered track/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Add or prepare a release/i })).toBeVisible();
    await expect(page.getByText("How Ensemblis uses your source", { exact: true })).toBeVisible();
  });

  test("2. mastering a track keeps readiness before engineering controls", async ({ page }) => {
    const track = await firstPlayableCatalogTrack(page);
    await page.goto(track.href);

    await expect(page.getByText("Source audio", { exact: true })).toBeVisible();
    await expect(page.getByText("Next action", { exact: true })).toBeVisible();
    await auditCheckpoint(page, "02-track");

    const master = page.getByRole("link", { name: "Master", exact: true });
    await expect(master).toBeVisible();
    await master.click();

    await expect(page.getByText("Master Readiness", { exact: true })).toBeVisible();
    await auditCheckpoint(page, "02-mastering");
    await expect(
      page.getByText("Creative mastering, references, listening comparison and engineering detail", { exact: true }),
    ).toBeVisible();
  });

  test("3. Create preserves the requested track and deliverable", async ({ page }) => {
    const track = await firstPlayableCatalogTrack(page);
    await queryLauncher(page, "make a reel from " + track.title);

    const result = page.getByRole("link", {
      name: new RegExp("Create from " + escapeRegex(track.title), "i"),
    }).first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.getByRole("heading", { name: "Create" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Music-led creative" })).toBeVisible();
    await auditCheckpoint(page, "03-create");
    await expect(page.getByText("Requested", { exact: true }).first()).toBeVisible();
  });

  test("Release Visual starts from cover artwork and stays zero-spend-first", async ({ page }) => {
    const release = await firstReleaseWithArtwork(page);
    await queryLauncher(page, "make an Out Now Story for " + release.title);

    const result = page.getByRole("link", {
      name: new RegExp("Create a release visual for " + escapeRegex(release.title), "i"),
    }).first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.getByRole("heading", { name: "Create a release visual" })).toBeVisible();
    const visualCard = page.locator(".release-visual-create-card").first();
    await expect(visualCard).toBeVisible();
    await expect(visualCard.getByText("Zero-spend default", { exact: true })).toBeVisible();
    await visualCard.getByRole("button", { name: "Create visual" }).click();

    await page.waitForURL(/\/studio\/create\/visual\/[0-9a-f-]+/i);
    await expect(page.getByRole("heading", { name: "Release Visual" })).toBeVisible();
    const progress = page.getByRole("navigation", { name: "Workflow progress" });
    await expect(progress).toBeVisible();
    for (const step of ["Source", "Message", "Design", "Review", "Use"]) {
      await expect(progress.getByRole("button", { name: new RegExp(step, "i") })).toBeVisible();
    }

    await expect(page.getByRole("radio", { name: /Out Now/i })).toBeVisible();
    await page.getByRole("radio", { name: /Out Now/i }).click();
    await page.getByRole("button", { name: "Continue to design" }).click();
    await expect(page.getByRole("heading", { name: "Compose the actual social artwork" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Story · 9:16/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review this design" })).toBeVisible();
    await auditCheckpoint(page, "release-visual-desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Release Visual" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review this design" })).toBeVisible();
    await auditCheckpoint(page, "release-visual-mobile");
  });

  test("4. a release leads with its lifecycle plan and one next move", async ({ page }) => {
    const release = await firstRelease(page);
    await page.goto(release.href);

    await expect(page.getByText("Release plan", { exact: true }).first()).toBeVisible();
    await auditCheckpoint(page, "04-release");
    const plan = page.locator(".release-mission-hero");
    const tracks = page.locator(".release-tracklist");
    await expect(plan).toBeVisible();
    await expect(tracks).toBeVisible();

    const planBox = await plan.boundingBox();
    const tracksBox = await tracks.boundingBox();
    expect(planBox && tracksBox && planBox.y < tracksBox.y).toBeTruthy();

    for (const label of ["Overview", "Creative", "Promotion", "Distribution", "Results"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("5. AutoMix exposes Music → Intent → Build → Review → Render", async ({ page }) => {
    await openStudio(page, "/studio/music/automix");
    await expect(page.getByRole("heading", { name: "AutoMix" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where should the music come from?" })).toBeVisible();
    await auditCheckpoint(page, "05-automix");

    const catalog = page.getByRole("button", { name: /Ensemblis catalog/i });
    const local = page.getByRole("button", { name: /Local music library|This computer/i });
    if (await catalog.isEnabled()) await catalog.click();
    else await local.click();

    const progress = page.getByRole("navigation", { name: "Workflow progress" });
    await expect(progress).toBeVisible();
    for (const step of ["Music", "Intent", "Build", "Review", "Render"]) {
      await expect(progress.getByRole("button", { name: new RegExp(step) })).toBeVisible();
    }
  });

  test("6. Grow answers what to do before asking the artist to read metrics", async ({ page }) => {
    await openStudio(page, "/studio/growth");

    await expect(page.getByRole("heading", { name: "Grow" })).toBeVisible();
    const recommendation = page.locator(".growth-v5-recommendation");
    const evidence = page.locator(".growth-v5-evidence-grid");
    await expect(recommendation).toBeVisible();
    await expect(page.getByText("Recommended next action", { exact: true })).toBeVisible();
    await auditCheckpoint(page, "06-grow");
    await expect(page.getByText("Opportunities", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("In motion", { exact: true }).first()).toBeVisible();

    const recommendationBox = await recommendation.boundingBox();
    const evidenceBox = await evidence.boundingBox();
    expect(recommendationBox && evidenceBox && recommendationBox.y < evidenceBox.y).toBeTruthy();
  });

  test("7. release Results interprets evidence instead of stopping at metrics", async ({ page }) => {
    const release = await firstRelease(page);
    await page.goto(release.href);
    await page.getByRole("link", { name: "Results", exact: true }).click();

    await expect(page.getByRole("heading", { name: "What the release is teaching us" })).toBeVisible();
    await expect(page.getByText("What this means", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review opportunities" })).toBeVisible();
  });

  test("8. Needs You is one bounded decision queue and preserves a calm empty state", async ({ page }) => {
    await openStudio(page, "/studio/needs-you");

    await expect(page.getByRole("heading", { name: "Needs You" })).toBeVisible();
    await expect(page.getByText("Decision queue", { exact: true })).toBeVisible();
    await auditCheckpoint(page, "08-needs-you");
    await expect(
      page.getByText(/decision.*worth your attention|Ensemblis can keep moving/i).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Today" })).toBeVisible();
  });

  test("9. failed AutoMix render exposes exact-plan recovery without silently replanning", async ({ page }) => {
    await openStudio(page, "/studio");

    const now = new Date().toISOString();
    const failedJob = {
      id: "e2e-failed-render",
      owner_id: "e2e",
      artist_id: "e2e",
      name: "Acceptance recovery mix",
      purpose: "journey",
      energy_profile: "smooth",
      transition_style: "clean",
      output_format: "mp3",
      target_duration_ms: 900000,
      track_ids: [],
      source_fingerprints: {},
      status: "failed",
      idempotency_key: "e2e",
      output_bucket: "media",
      output_path: "e2e.mp3",
      output_asset_id: null,
      request_payload: {
        execution_mode: "approved_render",
        plan_lineage: { root_job_id: "e2e-root" },
      },
      result_payload: {},
      external_job_id: null,
      error: "Synthetic acceptance failure",
      started_at: now,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };

    await page.route("**/api/studio/automix?artist=*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobs: [failedJob] }),
      });
    });

    await page.goto("/studio/music/automix?source=catalog");
    await expect(page.getByText("Render recovery", { exact: true })).toBeVisible();
    await expect(page.getByText("The frozen MixPlan is available for a safe retry.", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic acceptance failure", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry exact render/i })).toBeVisible();
  });

  test("10. advanced Track detail is intentionally reachable but secondary", async ({ page }) => {
    const track = await firstPlayableCatalogTrack(page);
    await page.goto(track.href);

    const details = page.getByRole("button", { name: "Technical details" });
    await expect(details).toBeVisible();
    await details.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Source|technical|analysis/i);
    await page.getByRole("button", { name: "Close details" }).click();
    await expect(dialog).toBeHidden();
  });

  test("mobile preserves the V5 mental model and contextual actions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page, "/studio");

    for (const label of ["Today", "Music", "Grow", "Ask", "More"]) {
      await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
    }

    await page.getByText("Music", { exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search music" })).toBeVisible();
    await auditCheckpoint(page, "mobile-music");

    const track = await firstPlayableCatalogTrack(page);
    await page.goto(track.href);
    const primaryAction = page.locator(".track-human-factors-recommendation .button.primary").first();
    await expect(primaryAction).toBeVisible();
    await auditCheckpoint(page, "mobile-track-primary-action");

    const details = page.getByRole("button", { name: "Technical details" });
    await details.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox && dialogBox.height >= 760).toBeTruthy();
    await page.getByRole("button", { name: "Close details" }).click();
  });
});
