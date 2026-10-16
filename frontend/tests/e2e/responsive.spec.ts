import { expect, test } from "@playwright/test";

const user = { id: "responsive-user", email: "creator@example.com", full_name: "Khmer voice creator",
  email_verified: true, created_at: "2026-10-15T00:00:00Z" };

for (const width of [320, 390, 768, 1024, 1440]) {
test(`studio screens and navigation fit at ${width}px`, async ({ page }, info) => {
  await page.addInitScript((value) => {
    localStorage.setItem("bondeth.session", JSON.stringify({ access: "test-access", refresh: "test-refresh", user: value }));
  }, user);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path.endsWith("/auth/me")) json = user;
    else if (path.endsWith("/usage")) json = { signed_in: true, quotas: {} };
    else if (path.endsWith("/transcriptions")) json = { items: [], total: 0 };
    else if (path.endsWith("/tts/preview")) json = { primary_lang: "km", chunks: [] };
    else if (path.endsWith("/billing")) json = { enabled: false, plan: "free", can_manage: false, pro_quotas: {} };
    await route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  });

    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/stt", "/tts", "/clone", "/history", "/voices", "/api-keys", "/account"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
      await expect(page.locator("main > div").first()).toHaveCSS("filter", "blur(0px)");
      const overflow = await page.locator("main").evaluate((main) => ({
        page: document.documentElement.scrollWidth > innerWidth,
        elements: Array.from(main.querySelectorAll("input, textarea, button, pre, select, h2, h3"))
          .filter((el) => el.getClientRects().length && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1))
          .map((el) => `${el.tagName}: ${el.textContent?.slice(0, 60)}`),
      }));
      expect(overflow, `${path} at ${width}px`).toEqual({ page: false, elements: [] });
      if (path === "/api-keys" && (width === 320 || width === 1024)) {
        for (const panel of await page.locator("main .paper-panel").all()) {
          await expect(panel).toHaveCSS("opacity", "1");
        }
        for (const image of await page.locator("main img").all()) {
          await image.scrollIntoViewIfNeeded();
          await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
        }
        await page.screenshot({ path: info.outputPath(`api-keys-${width}.png`), fullPage: true });
      }
    }
    if (width < 1024) {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const close = page.getByRole("button", { name: "Close menu", exact: true });
      await expect(close).toBeVisible();
      await page.getByRole("link", { name: "Speech to Text", exact: true }).click();
      await expect(page).toHaveURL(/\/stt$/);
      await expect(close).toHaveCount(0);
    }
});
}
