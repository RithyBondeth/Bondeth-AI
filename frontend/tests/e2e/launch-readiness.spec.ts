import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: { signed_in: false, quotas: {} } }));
});

test("every page is served with security headers that confine scripts and outgoing requests", async ({ request }) => {
  for (const path of ["/", "/stt", "/login", "/privacy"]) {
    const headers = (await request.get(path)).headers();
    const csp = headers["content-security-policy"];
    expect(csp, path).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    // Only this site and the API may receive requests, so a leaked token has nowhere to go.
    expect(csp).toMatch(/connect-src 'self' http:\/\/localhost:8000 ws:\/\/localhost:8000(;|$)/);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("microphone=(self)");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});

test("the app runs under its content security policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  for (const path of ["/", "/tts", "/register", "/terms"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.getByRole("button", { name: /Switch to Khmer/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("លក្ខខណ្ឌប្រើប្រាស់");
  expect(violations).toEqual([]);
});

test("privacy and terms are reachable from the footer and from sign-up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  await expect(page.getByText("not sent to any third-party AI service")).toBeVisible();
  await expect(page.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");

  await page.goto("/register");
  const notice = page.locator("form").getByText("By creating an account");
  await expect(notice.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/terms");
  await notice.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);

  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of use");
  await expect(page.getByRole("link", { name: "Voice consent policy" }).first()).toHaveAttribute("href", "/voice-consent");
});
