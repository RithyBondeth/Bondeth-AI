import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: { signed_in: false, quotas: {} }, headers: { "Access-Control-Allow-Origin": "*" } }));
});

test("API links open the native guide and examples can be searched, switched, and copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/stt");
  await page.locator("header").getByRole("link", { name: "API docs", exact: true }).click();
  await expect(page).toHaveURL(/\/api$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("API docs");
  await expect(page.getByRole("heading", { name: "Build with Khmer voice." })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "API keys", exact: true }).last()).toHaveAttribute("href", "/api-keys");
  const search = page.getByRole("textbox", { name: "Search endpoints" });
  await search.fill("/clone");
  const endpoint = page.locator("article");
  await expect(endpoint).toHaveCount(1);
  await endpoint.getByRole("button", { name: "JavaScript", exact: true }).click();
  await expect(endpoint.locator("pre")).toContainText('form.set("consent", "true")');
  await expect(endpoint.locator("pre")).toContainText("process.env.BONDETH_API_KEY");
  await endpoint.getByRole("button", { name: "Copy Voice Clone javascript", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('form.set("reference_audio"');
  for (const [target, expected] of [
    ["Python", 'with open("voice.wav", "rb") as audio:'],
    ["Next.js", 'import "server-only"'],
    ["Express", 'Router()'],
    ["Laravel", "Http::withHeaders"],
  ]) {
    await endpoint.getByRole("button", { name: target, exact: true }).click();
    await expect(endpoint.locator("pre")).toContainText(expected);
  }
  await endpoint.getByRole("button", { name: "Copy Voice Clone laravel", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("$response->throw()");
  await endpoint.getByRole("button", { name: "Example response", exact: true }).click();
  await expect(endpoint.locator("pre")).toContainText("HTTP 202");
  await search.fill("no-such-endpoint");
  await expect(page.getByRole("status").filter({ hasText: "No matching endpoints" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator("article")).toHaveCount(7);
  const guide = page.locator("#frameworks");
  await guide.getByRole("button", { name: "Laravel", exact: true }).click();
  await expect(guide).toContainText("config/services.php");
  await guide.getByRole("button", { name: "Next.js", exact: true }).click();
  await expect(guide).toContainText(".env.local");
  await expect(page.locator("#audio-and-jobs")).toContainText("deadline");
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: "API docs", exact: true })).toHaveAttribute("href", "/api");
});

test("guide fits phones and desktops in both themes and localizes its navigation", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("bondeth.theme", "light"));
  await page.goto("/api");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.getByRole("button", { name: /Switch to Khmer/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ឯកសារ API");
  await expect(page.getByRole("textbox", { name: "ស្វែងរកចំណុចចូល API" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect.poll(() => page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /Switch to English/ }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
  await expect(page.locator("main > div").first()).toHaveCSS("filter", "blur(0px)");
  await page.screenshot({ path: info.outputPath("api-guide.png") });
});
