import { expect, test } from "@playwright/test";

const publicPaths = ["/", "/stt", "/tts", "/clone", "/api", "/voice-consent", "/privacy", "/terms"];
const privatePaths = ["/login", "/register", "/forgot-password", "/reset-password?token=private-test-token", "/verify-email?token=private-test-token", "/account", "/audio", "/voices", "/api-keys", "/history", "/history/private-transcript"];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: { signed_in: false, quotas: {} } }));
  // /tts previews its prefilled text after a debounce; a reply without chunks would crash the page.
  await page.route("**/api/v1/tts/preview", (route) => route.fulfill({ json: { engine: "mms", chunks: [] } }));
});

test("public pages serve unique metadata, canonical URLs, social cards and structured data without JavaScript", async ({ request, page }) => {
  test.setTimeout(120_000); // Eight full navigations plus asset checks, including on busy CI workers.
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of publicPaths) {
    const response = await request.get(`${path}?utm_source=seo-test`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('type="application/ld+json"');
    await page.goto(`${path}?utm_source=seo-test`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    const url = new URL((await canonical.getAttribute("href"))!);
    expect(url.pathname).toBe(path);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    const title = await page.title();
    expect(title).toContain("Bondeth AI");
    expect(titles.has(title)).toBe(false);
    titles.add(title);
    const description = (await page.locator('meta[name="description"]').getAttribute("content"))!;
    expect(description.length).toBeGreaterThan(70);
    expect(description.length).toBeLessThan(180);
    expect(descriptions.has(description)).toBe(false);
    descriptions.add(description);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", description);
    const socialUrl = new URL((await page.locator('meta[property="og:url"]').getAttribute("content"))!);
    expect(socialUrl.href).toBe(url.href);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const graphs = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent!)));
    expect(graphs).toHaveLength(1);
    expect(graphs[0]["@context"]).toBe("https://schema.org");
    expect(graphs[0]["@graph"][0].url).toBe(url.href);
    if (path === "/") expect(graphs[0]["@graph"].map((node: { "@type": string }) => node["@type"])).toEqual(["WebPage", "WebSite", "WebApplication"]);
    else expect(graphs[0]["@graph"][1]["@type"]).toBe("BreadcrumbList");
    expect(JSON.stringify(graphs)).not.toMatch(/aggregateRating|reviewCount/);
    // There are no independently rendered language URLs yet; never invent hreflang variants.
    await expect(page.locator('link[hreflang]')).toHaveCount(0);
    const image = new URL((await page.locator('meta[property="og:image"]').getAttribute("content"))!);
    expect(image.origin).toBe(url.origin);
    expect(image.pathname).toBe("/opengraph-image.png");
    expect((await request.get(image.pathname)).status()).toBe(200);
  }
});

test("private and authentication routes are noindex and never publish user IDs or token canonicals", async ({ page, request }) => {
  test.setTimeout(90_000); // Inspect every private template, including the dynamic transcript route.
  for (const path of privatePaths) {
    const response = await request.get(path);
    const html = await response.text();
    expect(html).toMatch(/name="robots" content="[^"]*noindex/);
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    expect(await page.title()).not.toMatch(/private-test-token|private-transcript/);
  }
});

test("robots and sitemap agree with indexing policy and list only public canonical pages", async ({ request, page }) => {
  await page.goto("/");
  const root = new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!);
  const indexable = !(await page.locator('meta[name="robots"]').getAttribute("content"))!.includes("noindex");
  const robots = await request.get("/robots.txt");
  const sitemap = await request.get("/sitemap.xml");
  expect(robots.status()).toBe(200);
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const rules = await robots.text();
  const xml = await sitemap.text();
  if (indexable) {
    expect(rules).toContain("Allow: /");
    expect(rules).toContain(`Sitemap: ${root.origin}/sitemap.xml`);
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    expect(urls.sort()).toEqual(publicPaths.map((path) => new URL(path, root).href).sort());
    // No private disallow rule that would prevent crawlers from seeing noindex.
    expect(rules).not.toContain("Disallow:");
  } else {
    expect(rules).toContain("Disallow: /");
    expect(xml).not.toContain("<loc>");
  }
  expect(xml).not.toMatch(/private-test-token|private-transcript|<lastmod>/);
});

test("client navigation and language changes retain the English SEO title when switching back", async ({ page }) => {
  await page.goto("/api");
  await expect(page).toHaveTitle("Khmer Speech API Documentation · Bondeth AI");
  await page.getByRole("button", { name: /Switch to Khmer/ }).click();
  await expect(page).toHaveTitle("ឯកសារ API · Bondeth AI");
  await page.getByRole("button", { name: /Switch to English/ }).click();
  await expect(page).toHaveTitle("Khmer Speech API Documentation · Bondeth AI");
  const openMenu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await openMenu.isVisible()) await openMenu.click();
  await page.getByRole("link", { name: "Speech to Text", exact: true }).click();
  await expect(page).toHaveTitle("Khmer & English Speech to Text · Bondeth AI");
});
