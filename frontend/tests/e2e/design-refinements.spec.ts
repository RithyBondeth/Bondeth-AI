import { expect, test } from "@playwright/test";

test("hero tools support keyboard selection and open the selected workspace", async ({ page }, info) => {
  await page.setViewportSize({ width: 1065, height: 869 });
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Explore voice tools" });
  const panel = page.getByRole("tabpanel", { name: "Speech to Text", exact: true });
  await expect(panel.getByRole("link", { name: "Open Speech to Text" })).toHaveAttribute("href", "/stt");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("opacity", "1");
  await expect.poll(() => panel.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: info.outputPath("hero-refined.png") });
  await tabs.getByRole("tab", { name: "Speech to Text", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const speech = tabs.getByRole("tab", { name: "Text to Speech", exact: true });
  await expect(speech).toBeFocused();
  await expect(speech).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Text to Speech", exact: true }).getByRole("img"))
    .toHaveAttribute("alt", "A Cambodian man listening with headphones");
  await page.keyboard.press("End");
  const clone = page.getByRole("tabpanel", { name: "Voice Clone", exact: true });
  await expect(clone.getByRole("link", { name: "Open Voice Clone" })).toHaveAttribute("href", "/clone");
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "Speech to Text", exact: true })).toBeFocused();
  await tabs.getByRole("tab", { name: "Text to Speech", exact: true }).click();
  await page.getByRole("link", { name: "Open Text to Speech", exact: true }).click();
  await expect(page).toHaveURL(/\/tts$/);
});

for (const mode of ["login", "register"]) {
  test(`${mode} preserves the password when revealing it and submits only from the primary action`, async ({ page }, info) => {
    const submitted: unknown[] = [];
    await page.addInitScript(() => localStorage.setItem("bondeth.theme", "light"));
    await page.route("**/api/v1/**", async (route) => {
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (new URL(route.request().url()).pathname === `/api/v1/auth/${mode}`) {
        submitted.push(route.request().postDataJSON());
        return route.fulfill({ status: 401, json: { detail: "Incorrect email or password" }, headers: cors });
      }
      return route.fulfill({ json: { signed_in: false, quotas: {} }, headers: cors });
    });
    await page.goto(`/${mode}`);
    const settings = page.getByRole("group", { name: "Language and appearance" });
    await expect(settings.getByRole("button", { name: /Switch to Khmer/ })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Toggle light and dark theme" })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("placeholder", "Email address");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("placeholder", mode === "login" ? "Enter your password" : "Create a password (8+ characters)");
    for (const width of [320, 1065]) {
      await page.setViewportSize({ width, height: 869 });
      expect(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.locator("form").locator("..")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: info.outputPath(`${mode}-refined.png`), fullPage: true });
    await page.getByLabel("Email", { exact: true }).fill("design@example.com");
    if (mode === "register") await page.getByLabel("Name (optional)", { exact: true }).fill("Sokha");
    await password.fill("review-password-123");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("review-password-123");
    expect(submitted).toEqual([]);
    const hide = page.getByRole("button", { name: "Hide password", exact: true });
    await hide.focus();
    await hide.press("Enter");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("review-password-123");
    expect(submitted).toEqual([]);
    await page.getByRole("button", { name: mode === "login" ? "Sign in" : "Create account", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Incorrect email or password");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ [mode === "login" ? "username" : "email"]: "design@example.com", password: "review-password-123" });
  });
}
