import { expect, test, type Locator, type Page } from "@playwright/test";

const created = "2026-10-16T10:00:00Z";
const user = { id: "layout-user", email: "a.long.email.address.for.layout@example.com", full_name: "A creator with a longer display name",
  email_verified: true, created_at: created };
const voice = { id: "layout-voice", voice_alias: "My Khmer storytelling and narration voice", reference_text: "សួស្តី! ខ្ញុំចូលចិត្តនិយាយ និងអានរឿងជាភាសាខ្មែរ។", reference_duration_seconds: 29,
  created_at: created, consent_confirmed_at: created };
const keyError = "Couldn't create a key for this application. Please try again after checking your connection.";

async function fits(scope: Locator, label: string) {
  const issues = await scope.evaluate((root) => Array.from(root.querySelectorAll("button, input:not([type=file]), textarea, select, h1, h2, h3, p, dt, dd, pre"))
    .filter((el) => {
      const box = el.getBoundingClientRect();
      return el.getClientRects().length && box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
    }).map((el) => `${el.tagName}: ${el.textContent?.slice(0, 70)}`));
  expect.soft(issues, label).toEqual([]);
  expect.soft(await scope.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label).toBe(true);
  for (const name of ["Generate speech", "Clone & speak", "Add voice", "New key", "Save voice"]) {
    const action = scope.getByRole("button", { name, exact: true });
    if (await action.count()) {
      const wraps = await action.evaluate((button) => {
        const texts = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = texts.nextNode())) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (range.getClientRects().length > 1) return true;
        }
        return false;
      });
      expect.soft(wraps, `${name} label in ${label}`).toBe(false);
    }
  }
}

async function mockSession(page: Page) {
  await page.addInitScript((value) => localStorage.setItem("bondeth.session", JSON.stringify({ access: "test-access", refresh: "test-refresh", user: value })), user);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/api-keys") && route.request().method() === "POST") {
      await route.fulfill({ status: 422, json: { detail: keyError }, headers: { "Access-Control-Allow-Origin": "*" } });
      return;
    }
    let json: unknown = [];
    if (path.endsWith("/auth/me")) json = user;
    else if (path === "/api/v1/usage") json = { signed_in: true, quotas: {} };
    else if (path.endsWith("/voices")) json = [voice];
    else if (path.endsWith("/transcriptions")) json = { items: [{ id: "layout-transcript", language_code: "km", transcribed_text: voice.reference_text,
      audio_duration_seconds: 3599, created_at: created }], total: 1 };
    else if (path.endsWith("/api-keys")) json = [{ id: "layout-key", name: "Production Khmer storytelling application", prefix: "ba_live_123456789", created_at: created, last_used_at: created }];
    else if (path.includes("/api-keys/") && path.endsWith("/usage")) json = [{ day: "2026-10-16", requests: 1234567, stt_seconds: 1234567, tts_chars: 123456789, clone_jobs: 1234 }];
    else if (path.endsWith("/tts/preview")) json = { primary_lang: "km", chunks: [] };
    else if (path.endsWith("/billing")) json = { enabled: false, plan: "free", can_manage: false, pro_quotas: {} };
    await route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  });
}

for (const width of [320, 390, 768, 1024]) {
  test(`populated libraries and dialogs fit at ${width}px`, async ({ page }, info) => {
    await mockSession(page);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 740 });
    for (const path of ["/history", "/voices", "/api-keys", "/clone", "/tts", "/account"]) {
      await page.goto(path);
      await expect(page.locator("main > div").first()).toHaveCSS("filter", "blur(0px)");
      await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
      await fits(page.locator("body"), `${path} at ${width}px`);
      if (path === "/history") {
        const metadata = page.locator("main li").filter({ has: page.getByRole("button", { name: "Copy", exact: true }) }).locator(".row-start-2");
        expect.soft(await metadata.evaluate((el) => el.scrollWidth <= el.clientWidth), `history metadata at ${width}px`).toBe(true);
      }
      if (path === "/api-keys") {
        for (const stat of await page.locator("main dd").all()) {
          expect.soft(await stat.evaluate((el) => el.scrollWidth <= el.clientWidth), `key statistic at ${width}px`).toBe(true);
        }
        await page.getByRole("button", { name: "New key", exact: true }).click();
        await page.getByRole("dialog").getByLabel("Name").fill("Mobile layout check");
        await page.getByRole("button", { name: "Create key", exact: true }).click();
        await expect(page.locator('[aria-live="polite"]')).toContainText(keyError);
        await expect(page.locator('[aria-live="polite"] > div')).toHaveCSS("opacity", "1");
        const notification = await page.locator('[aria-live="polite"] > div').boundingBox();
        expect(notification!.x).toBeGreaterThanOrEqual(0);
        expect(notification!.x + notification!.width).toBeLessThanOrEqual(width);
        await fits(page.locator("body"), `Key dialog and notification at ${width}px`);
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
      if (path === "/voices") {
        await page.getByRole("button", { name: "Add voice", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
        await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })).toBeInViewport();
        await fits(page.getByRole("dialog"), `Add voice dialog at ${width}px`);
        const save = page.getByRole("dialog").getByRole("button", { name: "Save voice", exact: true });
        await save.scrollIntoViewIfNeeded();
        await expect(save).toBeInViewport();
        await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })).toBeInViewport();
        if (width === 320) await page.screenshot({ path: info.outputPath("add-voice-dialog-320.png") });
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
      if (width === 320 && ["/history", "/voices", "/api-keys", "/clone", "/tts"].includes(path)) {
        await page.screenshot({ path: info.outputPath(`${path.slice(1)}-${width}.png`), fullPage: true });
      }
    }
  });
}

test("account forms fit a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/voice-consent"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await fits(page.locator("body"), path);
  }
});
