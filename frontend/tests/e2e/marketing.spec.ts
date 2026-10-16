import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`marketing illustrations and header fit all breakpoints in ${theme} mode`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript((value) => localStorage.setItem("bondeth.theme", value), theme);
    await page.route("**/api/v1/**", (route) => route.fulfill({
      json: { quotas: {}, signed_in: false }, headers: { "Access-Control-Allow-Origin": "*" },
    }));

    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Speak Khmer. Be heard." })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);

      const header = page.locator("header");
      const studio = header.getByRole("link", { name: width < 640 ? "Studio" : "Open studio", exact: true });
      await expect(studio).toBeVisible();
      expect(await studio.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(width);

      for (const image of await page.locator("img.illustration-art").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      }
      if (width === 320 || width === 1440) {
        for (const panel of await page.locator(".feature-paper").all()) {
          await panel.scrollIntoViewIfNeeded();
          await expect(panel).toHaveCSS("opacity", "1");
        }
        const closing = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your voice, in your language." }) });
        await closing.scrollIntoViewIfNeeded();
        await expect(closing).toHaveCSS("opacity", "1");
        await page.getByRole("heading", { name: "Speak Khmer. Be heard." }).scrollIntoViewIfNeeded();
        await expect(page.getByText("No installation needed", { exact: true })).toHaveCSS("opacity", "1");
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          scrollTo(0, 0);
        });
        await page.screenshot({ path: info.outputPath(`marketing-${theme}-${width}.png`), fullPage: true });
      }
      await page.goto("/");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#main-content$/);
    }
    expect(errors).toEqual([]);
  });
}
