import { test, expect } from "@playwright/test";

const TRACE_HEADER = "x-ensemblis-trace-id";

test("public artist site and private Studio keep distinct indexing contracts", async ({ page, request }) => {
  const publicResponse = await page.goto("/");
  expect(publicResponse?.ok()).toBeTruthy();
  await expect(page.locator("body")).toContainText(/Atlas Irwin/i);
  expect(publicResponse?.headers()["x-robots-tag"]).toBeUndefined();

  const studioResponse = await request.get("/studio/access-denied");
  expect(studioResponse.ok()).toBeTruthy();
  expect(studioResponse.headers()["x-robots-tag"]).toContain("noindex");

  await page.goto("/studio/access-denied");
  await expect(page.getByText("Ensemblis", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
});

test("contact validation is traceable without invoking email delivery", async ({ request }) => {
  const traceId = "e2e-contact-validation-0001";
  const response = await request.post("/api/contact", {
    headers: { [TRACE_HEADER]: traceId },
    data: {
      name: "",
      email: "not-an-email",
      message: "",
    },
  });

  expect(response.status()).toBe(400);
  expect(response.headers()[TRACE_HEADER]).toBe(traceId);
  expect(await response.json()).toEqual({
    message: "Please add your name, a valid email, and a message.",
  });
});

test("contact honeypot remains fail-closed while preserving traceability", async ({ request }) => {
  const response = await request.post("/api/contact", {
    data: {
      name: "Automated submission",
      email: "bot@example.com",
      message: "Ignore this submission",
      company: "spam-company",
    },
  });

  expect(response.ok()).toBeTruthy();
  expect(response.headers()[TRACE_HEADER]).toBeTruthy();
  expect(await response.json()).toEqual({ message: "Message sent. Thank you." });
});
