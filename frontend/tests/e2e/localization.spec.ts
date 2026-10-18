import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { translate } from "../../src/lib/i18n";
import { khmerMessages } from "../../src/lib/messages-km";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,PATCH,POST,OPTIONS" };
const user = { id: "locale-user", email: "locale@example.com", full_name: "Speech", email_verified: true,
  created_at: "2026-10-16T00:00:00Z" };
const transcriptId = "00000000-0000-0000-0000-000000000011";

async function setup(page: Page, signedIn = false) {
  if (signedIn) await page.addInitScript((value) => localStorage.setItem("bondeth.session",
    JSON.stringify({ access: "locale-access", refresh: "refresh", user: value })), user);
  const server = {
    document: { id: transcriptId, language_code: "km", transcribed_text: "Original text ខ្មែរ", segmented_text: "Original text ខ្មែរ" as string | null,
      segments: [{ start: 0, end: 2, text: "Original text ខ្មែរ" }], revision: 1,
      audio_duration_seconds: 2, created_at: user.created_at, updated_at: null as string | null },
    patches: 0,
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/login") return route.fulfill({ status: 401, json: { detail: "Incorrect email or password" }, headers });
    if (path === `/api/v1/transcriptions/${transcriptId}`) {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON(); server.patches++;
        server.document = { ...server.document, segments: body.segments, transcribed_text: body.segments[0].text, segmented_text: null,
          revision: server.document.revision + 1, updated_at: user.created_at };
      }
      return route.fulfill({ json: server.document, headers });
    }
    const json = path.endsWith("/auth/me") ? user
      : path === "/api/v1/voices" || path === "/api/v1/api-keys" ? []
      : path === "/api/v1/audio" || path === "/api/v1/transcriptions" ? { items: [], total: 0 }
      : path === "/api/v1/billing" ? { enabled: false, plan: "free", subscription_status: null,
        valid_until: null, can_manage: false, pro_quotas: { stt_seconds: 0, tts_chars: 0, clone_jobs: 0 } }
      : path === "/api/v1/tts/preview" ? { engine: "mms", chunks: [] }
      : { signed_in: signedIn, account: signedIn ? "verified" : "none", plan: "free", quotas: {} };
    await route.fulfill({ json, headers });
  });
  return server;
}

async function khmer(page: Page) {
  await page.getByRole("button", { name: "Switch to Khmer / ប្ដូរទៅភាសាខ្មែរ", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "km");
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.locator("body").evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true);
}

test("switches public and auth pages, remembers both choices, and translates account errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Speak Khmer.");
  // The switch is a standard keyboard-operable button.
  const language = page.getByRole("button", { name: /Switch to Khmer/ });
  await language.focus(); await language.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("និយាយភាសាខ្មែរ។");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "km");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("និយាយភាសាខ្មែរ។");
  await page.goto("/voice-consent");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("គោលការណ៍យល់ព្រមលើសំឡេង");
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("ចម្លងតែសំឡេងដែលអ្នកមានសិទ្ធិប្រើ");
  await page.goto("/login");
  await page.getByLabel("អ៊ីមែល", { exact: true }).fill("person@example.com");
  await page.getByLabel("ពាក្យសម្ងាត់", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "ចូលគណនី", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("អ៊ីមែលឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ");
  await expect(page).toHaveTitle("ចូលគណនី · Bondeth AI");
  await page.getByRole("button", { name: /Switch to English/ }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("person@example.com");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("wrong-password");
  await expect(page.locator("form").getByRole("alert")).toHaveText("Incorrect email or password");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back");
  expect(await page.evaluate(() => localStorage.getItem("bondeth.locale"))).toBe("en");
  expect(errors).toEqual([]);
});

test("translates every studio workspace and library without losing text or speech-language settings", async ({ page }, info) => {
  await setup(page, true);
  await page.goto("/tts");
  await page.getByRole("textbox", { name: "Text to speak" }).fill("My draft ខ្មែរ");
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await khmer(page);
  await expect(page.getByRole("textbox", { name: "អត្ថបទដែលត្រូវអាន" })).toHaveValue("My draft ខ្មែរ");
  await expect(page.getByRole("radio", { name: "អង់គ្លេស", exact: true })).toHaveAttribute("aria-checked", "true");
  for (const [path, heading, copy] of [
    ["/stt", "សំឡេងទៅអក្សរ", "សរសេរតាមសំឡេងផ្ទាល់"],
    ["/tts", "អក្សរទៅសំឡេង", "បង្កើតសំឡេង"],
    ["/clone", "ចម្លងសំឡេង", "ចម្លងនិងនិយាយ"],
    ["/audio", "បណ្ណាល័យសំឡេង", "មិនទាន់មានសំឡេងបានរក្សាទុក"],
    ["/history", "ប្រវត្តិ", "មិនទាន់មានអត្ថបទ"],
    ["/voices", "សំឡេងរបស់អ្នក", "មិនទាន់មានសំឡេង"],
    ["/api-keys", "កូនសោ API", "មិនទាន់មានកូនសោ API"],
    ["/account", "គណនី", "គម្រោងឥតគិតថ្លៃ"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByText(copy, { exact: true }).first()).toBeVisible();
    await page.setViewportSize({ width: 320, height: 900 });
    await noOverflow(page);
  }
  // A name that happens to match an English message remains user data.
  await page.getByRole("button", { name: "បើកម៉ឺនុយ", exact: true }).click();
  await expect(page.getByText("Speech", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "បិទម៉ឺនុយ", exact: true }).click();
  await page.goto("/voices");
  await page.getByRole("button", { name: "បន្ថែមសំឡេង", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("ការអនុញ្ញាតច្បាស់លាស់ពីម្ចាស់សំឡេង");
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("khmer-voice-dialog-320.png"), fullPage: true });
});

test("keeps transcript edits, autosave and subtitle exports intact while switching", async ({ page }) => {
  const server = await setup(page, true);
  await page.goto(`/history/${transcriptId}`);
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("Text ខ្មែរ <tag>");
  await khmer(page);
  await expect(page.getByRole("radio", { name: "កែសម្រួល", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveTitle("កែសម្រួលអត្ថបទ · Bondeth AI");
  await expect(page.getByRole("textbox", { name: "អត្ថបទផ្នែក 1", exact: true })).toHaveValue("Text ខ្មែរ <tag>");
  await expect(page.getByRole("status").filter({ hasText: /^បានរក្សាទុក$/ })).toBeVisible();
  expect(server.document.transcribed_text).toBe("Text ខ្មែរ <tag>");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ទាញយក SRT", exact: true }).click();
  const download = await pending;
  expect(await readFile((await download.path())!, "utf8")).toBe("1\n00:00:00,000 --> 00:00:02,000\nText ខ្មែរ &lt;tag&gt;\n");
  await page.reload();
  await page.getByRole("radio", { name: "កែសម្រួល", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "អត្ថបទផ្នែក 1", exact: true })).toHaveValue("Text ខ្មែរ <tag>");
});

test("syncs preference across open tabs and resets after preference removal", async ({ page, context }) => {
  await setup(page);
  await page.goto("/login");
  const other = await context.newPage();
  await setup(other);
  await other.goto("/login");
  await khmer(page);
  await expect(other.getByRole("heading", { level: 1 })).toHaveText("ស្វាគមន៍ការត្រឡប់មកវិញ");
  await other.getByRole("button", { name: /Switch to English/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back");
  await khmer(page);
  await page.evaluate(() => localStorage.removeItem("bondeth.locale"));
  await expect(other.locator("html")).toHaveAttribute("lang", "en");
  await other.close();
});

test("invalid or blocked storage keeps the interface usable and preference works in memory", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem("bondeth.locale", "fr");
    Object.defineProperty(Storage.prototype, "setItem", { value: () => { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Email", { exact: true }).fill("keep@example.com");
  await khmer(page);
  await expect(page.getByLabel("អ៊ីមែល", { exact: true })).toHaveValue("keep@example.com");
  await page.getByRole("link", { name: "បង្កើតគណនីមួយ", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("បង្កើតគណនីរបស់អ្នក");
});

test("message parameters stay literal and unknown diagnostics retain their content", () => {
  expect(translate("en", "{count} saved", { count: 2 })).toBe("2 saved");
  expect(translate("km", "{count} saved", { count: 2 })).toBe("បានរក្សាទុក 2");
  expect(translate("km", "Revoke {name}", { name: "Speech {count} <b>" })).toBe("ដកហូត Speech {count} <b>");
  expect(translate("km", "Text exceeds 2000 characters")).toBe("អត្ថបទលើស 2000 តួអក្សរ");
  expect(translate("km", "Too many requests. Try again in 30 s.")).toBe("មានសំណើច្រើនពេក។ សូមព្យាយាមម្ដងទៀតក្នុងរយៈពេល 30 វិនាទី។");
  const limit = translate("km", "You've used today's text-to-speech allowance (2,000 characters). Sign in for a larger allowance. It resets at midnight (UTC+7).");
  expect(limit).toContain("2,000 តួអក្សរ");
  expect(limit).toContain("UTC+7");
  expect(limit).not.toMatch(/allowance|Sign in|midnight/);
  expect(translate("km", "This needs 2 clone jobs of voice cloning but only 1 clone job of today's allowance is left. It resets at midnight (UTC+7)."))
    .toContain("ការចម្លងសំឡេង 2");
  expect(translate("km", "Verify your email to use voice cloning. It resets at midnight (UTC+7)."))
    .toContain("សូមបញ្ជាក់អ៊ីមែលរបស់អ្នកដើម្បីប្រើ");
  expect(translate("km", "Unknown diagnostic ABC")).toBe("Unknown diagnostic ABC");
  expect(translate("km", "constructor")).toBe("constructor");
  for (const [source, translated] of Object.entries(khmerMessages)) {
    expect(translated.trim(), source).not.toBe("");
    expect([...translated.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), source)
      .toEqual([...source.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
  }
});

test("Khmer public pages and subtitle controls fit phone, tablet and desktop in both themes", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (/hydration|hydrated|didn't match/i.test(message.text())) errors.push(message.text()); });
  await setup(page, true);
  await page.goto("/");
  await khmer(page);
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("និយាយភាសាខ្មែរ។");
      await page.evaluate(() => document.fonts.ready);
      await noOverflow(page);
      const language = page.getByRole("button", { name: /Switch to English/ });
      await expect(language).toBeVisible();
      expect(await language.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
      if (width === 320) await page.screenshot({ path: info.outputPath(`khmer-home-${theme}.png`), fullPage: true });
      await page.goto(`/history/${transcriptId}`);
      await page.getByRole("radio", { name: "កែសម្រួល", exact: true }).click();
      await expect(page.getByRole("button", { name: "ទាញយក SRT", exact: true })).toBeVisible();
      await noOverflow(page);
      if (width === 320 || width === 1440) {
        await expect(page.locator("main > div")).toHaveCSS("filter", "blur(0px)");
        await page.screenshot({ path: info.outputPath(`khmer-transcript-${theme}-${width}.png`), fullPage: true });
      }
    }
    if (theme === "light") await page.getByRole("button", { name: "ប្ដូររវាងផ្ទៃភ្លឺនិងងងឹត", exact: true }).click();
  }
  expect(errors).toEqual([]);
});
