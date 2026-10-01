import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.STUDIO_ADMIN_EMAILS?.split(",")[0] || "").trim().toLowerCase();
const password = process.env.STUDIO_PASSWORD || "";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

test("Master Readiness stays consistent from Track through Distribution", async ({ page }) => {
  test.skip(!url || !serviceRole || !email || !password, "Authenticated Studio E2E credentials are not configured.");

  const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (profileError || !profile) test.skip(true, "Configured Studio admin profile is unavailable.");

  const { data: tracks, error: trackError } = await supabase
    .from("track_vault")
    .select("id,artist_id,linked_release_id,audio_url,audio_profile")
    .eq("owner_id", profile.id)
    .not("audio_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (trackError) throw trackError;

  const track = (tracks || []).find((item) => {
    const map = record(item.audio_profile);
    const inspector = record(map.mastering_inspector);
    const source = record(map.source_audio);
    return Object.keys(inspector).length > 0 && source.url === item.audio_url;
  });
  test.skip(!track, "No current analyzed master is available for the authenticated Studio account.");

  const next = `/studio/music/${track.id}?artist=${encodeURIComponent(track.artist_id)}#mastering`;
  await page.goto(`/studio/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(/\/studio\/music\//);
  await expect(page.getByText("Master Readiness", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Ready to release|Ready, but listen|Fix this before release|Checking the new master|Master verification unavailable/i,
    }),
  ).toBeVisible();
  await expect(page.getByText("Technical mastering details", { exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include(".track-object-page")
    .analyze();
  expect(
    accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)),
  ).toEqual([]);

  const { data: candidates, error: candidateError } = await supabase
    .from("track_mastering_jobs")
    .select("id,result_payload,status")
    .eq("owner_id", profile.id)
    .eq("artist_id", track.artist_id)
    .eq("track_vault_id", track.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(8);
  if (candidateError) throw candidateError;
  const verifiedCandidate = (candidates || []).find(
    (candidate) => record(record(candidate.result_payload).final_checks).pass === true,
  );
  if (verifiedCandidate) {
    await expect(page.getByRole("button", { name: "Use as canonical master" }).first()).toBeVisible();
  }

  if (track.linked_release_id) {
    await page.goto(
      `/studio/releases/${track.linked_release_id}/distribution?artist=${encodeURIComponent(track.artist_id)}`,
    );
    await expect(
      page.getByText(
        /Audio verified|Review suggested|Fix master before delivery|Audio verification in progress|Verification unavailable/i,
      ).first(),
    ).toBeVisible();
  }
});

