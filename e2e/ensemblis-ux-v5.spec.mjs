import { test, expect } from "@playwright/test";

const enabled = process.env.PLAYWRIGHT_STUDIO_E2E === "1";

test.describe("Ensemblis UX V5 authenticated journeys", () => {
  test.skip(!enabled, "Set PLAYWRIGHT_STUDIO_E2E=1 with an authenticated Studio base URL or safe local bypass.");

  test("Today starts from intent and one ranked next move", async ({ page }) => {
    await page.goto("/studio");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    const launcher = page.getByRole("button", { name: "Tell Ensemblis what you want to do" });
    await expect(launcher).toBeVisible();
    await launcher.click();

    const input = page.getByRole("textbox", { name: "Tell Ensemblis what you want to do" });
    await input.fill("add music");
    await expect(page.getByRole("link", { name: /Add music/i }).first()).toBeVisible();
    await expect(page.getByText("Finding the right action…")).toBeHidden();
  });

  test("Music is an object-first library and Track keeps technical depth secondary", async ({ page }) => {
    await page.goto("/studio/music");
    await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search music" })).toBeVisible();

    for (const label of ["Tracks", "Releases", "Mixes"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    const firstTrack = page.locator(".music-v5-track-row a.button").first();
    await expect(firstTrack).toBeVisible();
    await firstTrack.click();

    await expect(page.getByText("Source audio", { exact: true })).toBeVisible();
    await expect(page.getByText("Next action", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Intelligence|Mastering|Stems|Lyrics/ })).toHaveCount(0);
    await expect(page.getByText("Analysis details", { exact: true })).toHaveCount(0);
  });

  test("Release leads with the release plan and Grow leads with a recommendation", async ({ page }) => {
    await page.goto("/studio/releases");
    const firstRelease = page.locator(".release-catalog-row").first();
    await expect(firstRelease).toBeVisible();
    await firstRelease.click();

    await expect(page.getByText("Release plan", { exact: true })).toBeVisible();
    const plan = page.locator(".release-mission-hero");
    const tracks = page.locator(".release-tracklist");
    await expect(plan).toBeVisible();
    await expect(tracks).toBeVisible();
    const planBox = await plan.boundingBox();
    const tracksBox = await tracks.boundingBox();
    expect(planBox && tracksBox && planBox.y < tracksBox.y).toBeTruthy();

    await page.goto("/studio/growth");
    await expect(page.getByRole("heading", { name: "Grow" })).toBeVisible();
    await expect(page.getByText("Recommended next action", { exact: true })).toBeVisible();
    await expect(page.getByText("Opportunities", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("In motion", { exact: true }).first()).toBeVisible();
  });

  test("mobile preserves the same mental model", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/studio");

    for (const label of ["Today", "Music", "Grow", "Ask", "More"]) {
      await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
    }

    await page.getByText("Music", { exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Music" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search music" })).toBeVisible();
  });
});
