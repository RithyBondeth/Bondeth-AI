import { test, expect } from "@playwright/test";

test("illustrated use cases support pointer and keyboard navigation", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Ways to use Bondeth" });
  const panel = page.locator("#ideas").getByRole("tabpanel");
  const creators = tabs.getByRole("tab", { name: /Make content/ });
  const ideas = tabs.getByRole("tab", { name: /Capture ideas/ });
  const developers = tabs.getByRole("tab", { name: /Build with voice/ });

  await expect(creators).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("link", { name: "Create a voiceover" })).toHaveAttribute("href", "/tts");
  await ideas.click();
  await expect(panel.getByRole("link", { name: "Start a transcript" })).toHaveAttribute("href", "/stt");
  await ideas.press("ArrowDown");
  await expect(developers).toBeFocused();
  await expect(developers).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("link", { name: "Explore API keys" })).toHaveAttribute("href", "/api-keys");
  await expect.poll(() => panel.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await developers.press("Home");
  await expect(creators).toBeFocused();
  await expect(creators).toHaveAttribute("aria-selected", "true");
  await expect(ideas).toHaveAttribute("tabindex", "-1");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundImage)).toBe("none");
  expect(await page.locator("h1").evaluate((heading) => getComputedStyle(heading).fontFamily)).not.toMatch(/Kalam|cursive/i);
});
