import { expect, test } from "@playwright/test";

for (const width of [768, 1024, 1180, 1440]) {
  test(`editor controls stay readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const user = { id: "workspace-test", email: "creator@example.com", full_name: "Voice creator", email_verified: true };
    await page.addInitScript((value) => {
      localStorage.setItem("bondeth.session", JSON.stringify({ access: "test-access", refresh: "test-refresh", user: value }));
      if (!localStorage.getItem("bondeth.theme")) localStorage.setItem("bondeth.theme", "light");
    }, user);
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = path.endsWith("/tts/preview") ? { primary_lang: "km", chunks: [] }
        : path.endsWith("/auth/me") ? user : path.endsWith("/voices") ? [] : { signed_in: true, quotas: {} };
      return route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*" } });
    });
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
      for (const path of ["/tts", "/clone"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("main > div").first()).toHaveCSS("filter", "blur(0px)");
        const editor = page.getByRole("textbox", { name: "Text to speak" }).locator("..");
        for (const state of width >= 1024 ? ["expanded", "collapsed"] : ["expanded"]) {
          if (state === "collapsed") {
            await page.getByRole("button", { name: "Collapse or expand sidebar" }).click();
            await expect.poll(() => page.locator("aside.sticky").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(72);
          }
          const wraps = await editor.evaluate((el) => {
            const issues: string[] = [];
            for (const part of el.querySelectorAll("h2, button, .tabular-nums, .text-ink-faint")) {
              if (!part.getClientRects().length) continue;
              const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
              let node: Node | null;
              while ((node = walker.nextNode())) {
                if (!node.textContent?.trim()) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                if (range.getClientRects().length > 1) issues.push(node.textContent.trim());
              }
            }
            return issues;
          });
          expect.soft(wraps, `${theme} ${width}px ${state}`).toEqual([]);
          expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          const editorBox = await editor.boundingBox();
          const settingsBox = await page.locator("main aside").boundingBox();
          expect(Math.abs(settingsBox!.y - editorBox!.y)).toBeLessThan(2);
          expect(editorBox!.width).toBeGreaterThanOrEqual(360);
          const shortcut = editor.getByText("⌘/Ctrl + Enter", { exact: true });
          if (editorBox!.width < 448) await expect(shortcut).toBeHidden();
          else await expect(shortcut).toBeVisible();
          for (const name of ["ខ្មែរ", "Numbers", "Mixed", "English"]) {
            await expect(editor.getByRole("button", { name, exact: true })).toBeVisible();
          }
          await expect(editor).toHaveCSS("opacity", "1");
          await page.screenshot({ path: info.outputPath(`${path.slice(1)}-${theme}-${width}-${state}.png`), fullPage: true });
          if (state === "collapsed") await page.getByRole("button", { name: "Collapse or expand sidebar" }).click();
        }
      }
    }
  });
}
