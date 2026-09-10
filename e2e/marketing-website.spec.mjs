import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("homepage resolves without hiding the CTA or loading audio", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/website");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your music.Understood.",
  );
  await expect(
    page.getByRole("link", { name: "Analyze a track" }).first(),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.locator("audio")).not.toHaveAttribute("src");
  const replay = page.getByRole("button", {
    name: "Replay analysis animation",
  });
  await replay.click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(3600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page
      .locator("[class*='heroWave'] [class*='structureBands']")
      .evaluate((element) => Number(getComputedStyle(element).opacity)),
  ).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});

test("all four demo perspectives work with keyboard and preserve one audio source", async ({
  page,
}) => {
  await page.goto("/website#demo");
  const demo = page.locator("#demo");
  await demo.getByRole("tab", { name: "Understand" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(demo.getByRole("tab", { name: "Refine" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await demo.getByRole("button", { name: "Mastering direction" }).click();
  await expect(demo.getByText("Keep the punch.")).toBeVisible();
  await demo.getByRole("tab", { name: "Mix & Perform" }).click();
  await demo.getByRole("button", { name: "Connect the tracks" }).click();
  await expect(demo.getByText("Relative keys")).toBeVisible();
  await demo.getByRole("tab", { name: "Promote" }).click();
  await demo
    .getByRole("button", { name: "Turn the moment into a teaser" })
    .click();
  await expect(
    demo.getByRole("button", { name: "Return to track moment" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("audio")).toHaveCount(1);
  await demo.getByRole("tab", { name: "Understand" }).click();
  await demo.getByRole("button", { name: "Energy", exact: true }).click();
  await expect(
    demo.getByText("Follow the rise. Feel the release."),
  ).toBeVisible();
});

test("audio failure is recoverable and leaves the example usable", async ({
  page,
}) => {
  await page.route("**/storage/v1/object/public/**/*.mp3", (route) =>
    route.abort(),
  );
  await page.goto("/website#demo");
  await page.getByRole("button", { name: "Listen to the track" }).click();
  await expect(page.locator("#demo").getByRole("alert")).toContainText(/Audio/);
  await expect(page.getByRole("button", { name: "Retry audio" })).toBeVisible();
  await page.getByRole("tab", { name: "Promote" }).click();
  await expect(page.getByRole("tabpanel")).toContainText(
    "Editorial campaign example",
  );
});

test("mobile menu supports Escape and all viewport sizes avoid clipped content", async ({
  page,
}) => {
  for (const width of [320, 390, 430, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/website");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `overflow at ${width}`,
    ).toBe(true);
    expect(
      await page
        .locator("h1")
        .evaluate(
          (element) =>
            element.getBoundingClientRect().right <= window.innerWidth,
        ),
      `headline at ${width}`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "The idea" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("reduced motion and no JavaScript preserve the full story", async ({
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(
    `${test.info().project.use.baseURL || process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100"}/website`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#hero-heading")).toContainText("Understood.");
  for (const id of [
    "analysis",
    "mastering",
    "mix",
    "promote",
    "artists",
    "demo",
  ])
    await expect(page.locator(`#${id}`)).toBeAttached();
  await expect(page.locator("[class*='scan']")).toBeHidden();
  await expect(
    page.getByRole("link", { name: "Analyze a track" }).nth(1),
  ).toBeVisible();
  await context.close();
});

test("every product page and share image is available", async ({
  page,
  request,
}) => {
  for (const slug of [
    "analysis",
    "mastering",
    "mix",
    "promote",
    "about",
    "pricing",
  ]) {
    const response = await page.goto(`/website/${slug}`);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  expect((await request.get("/website/opengraph-image")).status()).toBe(200);
  expect((await request.get("/website/not-a-page")).status()).toBe(404);
});

test("marketing upload CTA preserves its destination through the login entry", async ({
  page,
  request,
}) => {
  await page.goto("/website");
  await expect(
    page.getByRole("link", { name: "Analyze a track" }).first(),
  ).toHaveAttribute("href", "/studio/login?next=%2Fstudio%2Fmusic%2Fimport");
  // Development bypass redirects; production retains the destination in the real form.
  const valid = await request.get(
    "/studio/login?next=%2Fstudio%2Fmusic%2Fimport",
    { maxRedirects: 0 },
  );
  if (valid.status() === 200) {
    await page.goto("/studio/login?next=%2Fstudio%2Fmusic%2Fimport");
    await expect(page.locator('input[name="next"]')).toHaveValue("/studio/music/import");
  } else {
    expect(valid.headers().location).toMatch(/\/studio\/music\/import$/);
  }
  const malicious = await request.get(
    "/studio/login?next=https%3A%2F%2Fexample.com",
    { maxRedirects: 0 },
  );
  if (malicious.status() === 200) {
    await page.goto("/studio/login?next=https%3A%2F%2Fexample.com");
    await expect(page.locator('input[name="next"]')).toHaveValue("/studio");
  } else {
    expect(malicious.headers().location).toMatch(/\/studio$/);
  }
});

test("desktop and mobile meet automated WCAG AA checks", async ({ page }) => {
  test.setTimeout(120000);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/website");
    const results = await new AxeBuilder({ page })
      .include(".marketing-root")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});

test("playback, seeking, tabs and pause share the same media element", async ({
  page,
}) => {
  // Deterministic playable audio keeps CI independent of the artist's storage availability.
  const rate = 8000;
  const samples = rate * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * Math.PI * 2 * 220) / rate) * 500),
      44 + i * 2,
    );
  await page.route("**/storage/v1/object/public/**/*.mp3", (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2]
      ? Math.min(Number(range[2]), wav.length - 1)
      : wav.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "audio/wav",
      body: wav.subarray(start, end + 1),
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` }
          : {}),
      },
    });
  });
  await page.goto("/website#demo");
  await page.getByRole("button", { name: "Listen to the track" }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((audio) => audio.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Refine" }).click();
  expect(await page.locator("audio").evaluate((audio) => audio.paused)).toBe(
    false,
  );
  await page.getByRole("slider", { name: "Track playback position" }).fill("4");
  await expect
    .poll(() => page.locator("audio").evaluate((audio) => audio.currentTime))
    .toBeGreaterThanOrEqual(4);
  await page.getByRole("button", { name: "Pause track" }).click();
  expect(await page.locator("audio").evaluate((audio) => audio.paused)).toBe(
    true,
  );
});
