import { test, expect, type Page } from "@playwright/test";

const user = { id: "00000000-0000-0000-0000-000000000001", email: "user@example.com", full_name: "Test user",
  email_verified: true, created_at: "2026-10-15T00:00:00Z" };

async function session(page: Page) {
  await page.addInitScript((u) => {
    localStorage.setItem("bondeth.session", JSON.stringify({ access: "test-access", refresh: "test-refresh", user: u }));
  }, user);
}

async function mockApi(page: Page, billing = { enabled: false, plan: "free", can_manage: false }) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });
      return;
    }
    let json: unknown;
    if (path === "/api/v1/auth/me") json = user;
    else if (path === "/api/v1/usage") json = { signed_in: true, account: "verified", plan: billing.plan,
      resets_at: "2026-10-16T00:00:00+07:00", quotas: { tts_chars: { used: 0, limit: 50000, remaining: 50000 } } };
    else if (path === "/api/v1/tts/preview") json = { primary_lang: "km", chunks: [{ lang: "km", text: "សួស្តី" }] };
    else if (path === "/api/v1/billing") json = { ...billing, subscription_status: billing.plan === "pro" ? "active" : null,
      valid_until: null, pro_quotas: { stt_seconds: 18000, tts_chars: 250000, clone_jobs: 100 } };
    else if (path === "/api/v1/tts") {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.alloc(44),
        headers: { "Access-Control-Allow-Origin": "*" } });
      return;
    } else json = { detail: "Unexpected test endpoint" };
    await route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*" } });
  });
}

test("signed-in TTS sends the session credential", async ({ page }) => {
  await session(page);
  await mockApi(page);
  await page.goto("/tts");
  const pending = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/v1/tts" && r.method() === "POST");
  await page.getByRole("button", { name: "Generate speech" }).click();
  const request = await pending;
  expect(request.headers()["authorization"]).toBe("Bearer test-access");
  await expect(page.getByRole("button", { name: "Generate speech" })).toBeEnabled();
  await expect(page.getByLabel("Text to speak")).toBeVisible();
});

test("disabled billing shows the installation state without a checkout button", async ({ page }) => {
  await session(page);
  await mockApi(page);
  await page.goto("/account");
  await expect(page.getByText("Paid plans are not enabled on this installation.")).toBeVisible();
  await expect(page.getByRole("button", { name: "View Pro checkout" })).toHaveCount(0);
});

test("Pro subscriber can open the portal and sees the paid allowance", async ({ page }) => {
  await session(page);
  await mockApi(page, { enabled: true, plan: "pro", can_manage: true });
  await page.route("**/api/v1/billing/portal", (route) => route.fulfill({ json: { url: "https://billing.stripe.com/p/session/test" },
    headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route("https://billing.stripe.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Billing portal</h1>" }));
  await page.goto("/account");
  await expect(page.getByText("Bondeth Pro", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Pro checkout" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage subscription" }).click();
  await expect(page).toHaveURL("https://billing.stripe.com/p/session/test");
});

test("studio preserves the voice consent route", async ({ page }) => {
  await page.goto("/voice-consent");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
});
