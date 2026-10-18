import { expect, test } from "@playwright/test";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const user = { id: "email-language-user", email: "mail@example.com", full_name: null,
  email_verified: false, created_at: "2026-10-17T00:00:00Z" };

for (const initial of ["en", "km"] as const) {
  test(`account emails follow selected ${initial} language and subsequent changes`, async ({ page }) => {
    await page.addInitScript((locale) => {
      if (!localStorage.getItem("bondeth.locale")) localStorage.setItem("bondeth.locale", locale);
    }, initial);
    const sent: { path: string; language: string; authorization?: string; body: unknown }[] = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const path = new URL(request.url()).pathname;
      if (["/api/v1/auth/register", "/api/v1/auth/verify-email/resend", "/api/v1/auth/password-reset"].includes(path)) {
        const headers = request.headers();
        sent.push({ path, language: headers["accept-language"], authorization: headers["authorization"],
          body: request.postData() ? request.postDataJSON() : null });
        const json = path.endsWith("/register")
          ? { access_token: "email-access", refresh_token: "email-refresh", user } : { status: "sent" };
        return route.fulfill({ status: path.endsWith("/register") ? 201 : 202, json, headers: cors });
      }
      const json = path === "/api/v1/auth/me" ? user : path === "/api/v1/billing"
        ? { enabled: false, plan: "free", subscription_status: null }
        : { signed_in: false, account: "unverified", quotas: {} };
      await route.fulfill({ json, headers: cors });
    });

    await page.goto("/register");
    await expect(page.locator("html")).toHaveAttribute("lang", initial);
    await page.getByLabel(initial === "km" ? "អ៊ីមែល" : "Email", { exact: true }).fill(user.email);
    await page.getByLabel(initial === "km" ? "ពាក្យសម្ងាត់" : "Password", { exact: true }).fill("sample-password");
    await page.getByRole("button", { name: initial === "km" ? "បង្កើតគណនី" : "Create account", exact: true }).click();
    await expect(page).toHaveURL(/\/stt$/);
    expect(sent[0]).toMatchObject({ path: "/api/v1/auth/register", language: initial,
      body: { email: user.email, password: "sample-password", full_name: null } });

    const next = initial === "en" ? "km" : "en";
    await page.getByRole("button", { name: initial === "en" ? /Switch to Khmer/ : /Switch to English/ }).click();
    await page.getByRole("button", { name: next === "km" ? "ផ្ញើតំណម្ដងទៀត" : "Resend link", exact: true }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toMatchObject({ path: "/api/v1/auth/verify-email/resend", language: next, authorization: "Bearer email-access" });

    await page.goto("/account");
    await page.getByRole("button", { name: next === "km" ? "ផ្ញើតំណឱ្យខ្ញុំ" : "Email me a link", exact: true }).click();
    await expect.poll(() => sent.length).toBe(3);
    expect(sent[2]).toMatchObject({ path: "/api/v1/auth/password-reset", language: next, body: { email: user.email } });

    await page.getByRole("button", { name: next === "en" ? /Switch to Khmer/ : /Switch to English/ }).click();
    await page.goto("/forgot-password");
    await page.reload();
    await page.getByLabel(initial === "km" ? "អ៊ីមែល" : "Email", { exact: true }).fill("recovery@example.com");
    await page.getByRole("button", { name: initial === "km" ? "ផ្ញើតំណកំណត់ឡើងវិញ" : "Send reset link", exact: true }).click();
    await expect.poll(() => sent.length).toBe(4);
    expect(sent[3]).toMatchObject({ path: "/api/v1/auth/password-reset", language: initial, body: { email: "recovery@example.com" } });
    expect(sent[3].authorization).toBeUndefined();
  });
}
