import { expect, test } from "@playwright/test";

test("dark mobile text, field boundaries, and recording icons have sufficient contrast", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.setItem("bondeth.theme", "dark"));
  await page.route("**/api/v1/**", (route) => route.fulfill({
    json: new URL(route.request().url()).pathname.endsWith("/tts/preview") ? { primary_lang: "km", chunks: [] } : { signed_in: false, quotas: {} },
    headers: { "Access-Control-Allow-Origin": "*" },
  }));
  for (const path of ["/", "/login", "/register", "/stt", "/tts"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (path === "/stt") await page.getByRole("radio", { name: "Record or upload" }).click();
    if (path === "/stt" || path === "/tts") await expect(page.locator("main > div").first()).toHaveCSS("filter", "blur(0px)");
    if (path === "/login" || path === "/register") await expect(page.locator("form").locator("..")).toHaveCSS("opacity", "1");
    const failures = await page.locator("body").evaluate((body) => {
      const context = document.createElement("canvas").getContext("2d")!;
      function rgb(value: string) {
        context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      }
      function background(el: Element | null): number[] {
        if (!el) return [0, 0, 0, 255];
        const color = rgb(getComputedStyle(el).backgroundColor);
        const behind = background(el.parentElement);
        const alpha = color[3] / 255;
        return color.map((c, i) => i === 3 ? 255 : c * alpha + behind[i] * (1 - alpha));
      }
      function luminance(color: number[]) {
        return color.slice(0, 3).map((c) => c / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      }
      function ratio(fg: number[], bg: number[]) {
        const a = luminance(fg), b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }
      const errors: string[] = [];
      for (const tone of ["accent", "teal", "lilac", "rose"]) {
        const tokens = getComputedStyle(body);
        const contrast = ratio(rgb(tokens.getPropertyValue(`--${tone}-ink`)), rgb(tokens.getPropertyValue(`--${tone}`)));
        if (contrast < 4.5) errors.push(`${tone} control foreground: ${contrast.toFixed(2)}`);
      }
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (!el || !node.textContent?.trim() || el.closest("svg, script, style, .sr-only, button:disabled")) continue;
        const style = getComputedStyle(el);
        if (!el.getClientRects().length || style.visibility === "hidden") continue;
        // Scroll-reveal animations are verified separately; measure fully rendered text only.
        let visible = true;
        for (let parent: Element | null = el; parent; parent = parent.parentElement) {
          if (Number(getComputedStyle(parent).opacity) < 0.99) visible = false;
        }
        if (!visible) continue;
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        const contrast = ratio(rgb(style.color), background(el));
        if (contrast < (large ? 3 : 4.5)) errors.push(`text ${node.textContent.trim().slice(0, 45)}: ${contrast.toFixed(2)}`);
      }
      for (const input of body.querySelectorAll("input:not([type=hidden]):not([type=file]), textarea")) {
        if (!input.getClientRects().length) continue;
        const style = getComputedStyle(input);
        const contrast = ratio(rgb(style.borderTopColor), background(input));
        if (contrast < 3) errors.push(`field ${input.getAttribute("name") || input.getAttribute("aria-label")}: ${contrast.toFixed(2)}`);
      }
      const record = body.querySelector('button[aria-label="Start recording"]');
      if (record) {
        const icon = record.querySelector("svg")!;
        const contrast = ratio(rgb(getComputedStyle(icon).color), background(record));
        if (contrast < 3) errors.push(`record icon: ${contrast.toFixed(2)}`);
      }
      return errors;
    });
    expect.soft(failures, path).toEqual([]);
    if (path === "/login" || path === "/stt") {
      for (const panel of await page.locator(".paper-panel").all()) await expect(panel).toHaveCSS("opacity", "1");
      await page.screenshot({ path: info.outputPath(`dark-${path.slice(1)}-320.png`), fullPage: true });
    }
  }
});
