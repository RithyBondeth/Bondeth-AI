import { expect, test, type Page, type Route } from "@playwright/test";

const user = { id: "library-user", email: "library@example.com", full_name: "Library user", email_verified: true, created_at: "2026-10-16T00:00:00Z" };
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS" };

async function setup(page: Page, handle: (route: Route, url: URL) => Promise<boolean>) {
  await page.addInitScript((value) => localStorage.setItem("bondeth.session", JSON.stringify({
    access: "test-access", refresh: "test-refresh", user: value,
  })), user);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url());
    if (await handle(route, url)) return;
    const json = url.pathname.endsWith("/auth/me") ? user : url.pathname.endsWith("/tts/preview")
      ? { primary_lang: "en", chunks: [] } : { signed_in: true, quotas: {} };
    await route.fulfill({ json, headers });
  });
}

function wav() {
  const rate = 16000;
  const data = Buffer.alloc(44 + 2 * rate);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < rate; i++) data.writeInt16LE(Math.round(6000 * Math.sin(i * 220 * 2 * Math.PI / rate)), 44 + i * 2);
  return data;
}

test("history searches older pages, filters language, and resets pagination", async ({ page }) => {
  const transcripts = Array.from({ length: 25 }, (_, i) => ({ id: `recent-${i}`, language_code: "en", transcribed_text: `Recent ${i}`,
    created_at: user.created_at, audio_duration_seconds: 10 }));
  transcripts.push({ ...transcripts[0], id: "old-en", transcribed_text: "An older needle" },
    { ...transcripts[0], id: "old-km", language_code: "km", transcribed_text: "សួស្តី needle" });
  const requests: URL[] = [];
  await setup(page, async (route, url) => {
    if (url.pathname !== "/api/v1/transcriptions") return false;
    expect(route.request().headers()["authorization"]).toBe("Bearer test-access");
    requests.push(url);
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const language = url.searchParams.get("language");
    const matches = transcripts.filter((item) => item.transcribed_text.toLowerCase().includes(q) && (!language || item.language_code === language));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    await route.fulfill({ json: { items: matches.slice(offset, offset + 20), total: matches.length }, headers });
    return true;
  });
  await page.goto("/history");
  await expect(page.getByText("27 saved", { exact: true })).toBeVisible();
  await expect(page.getByText("An older needle", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("An older needle", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search transcripts" }).fill("needle");
  await expect(page.getByText("2 matches", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(page.getByText("1 matches", { exact: true })).toBeVisible();
  await expect(page.getByText("សួស្តី needle", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  const last = requests.at(-1)!;
  expect(last.searchParams.get("q")).toBe("needle");
  expect(last.searchParams.get("language")).toBe("en");
  expect(last.searchParams.has("offset")).toBe(false);
  await page.getByRole("searchbox", { name: "Search transcripts" }).fill("does not exist");
  await expect(page.getByText("Nothing matches your search.")).toBeVisible();
  await expect(page.getByText("No transcripts yet", { exact: true })).toHaveCount(0);
});

test("history shows a retryable error and ignores a canceled search", async ({ page }) => {
  let fail = true;
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, async (route, url) => {
    if (url.pathname !== "/api/v1/transcriptions") return false;
    if (fail) {
      await route.fulfill({ status: 503, json: { detail: "History temporarily unavailable" }, headers });
      return true;
    }
    const q = url.searchParams.get("q") ?? "";
    if (q === "slow") await blocked;
    await route.fulfill({ json: { items: [{ id: q || "initial", language_code: "en", transcribed_text: q || "Initial transcript",
      audio_duration_seconds: 10, created_at: user.created_at }], total: 1 }, headers }).catch(() => {});
    return true;
  });
  await page.goto("/history");
  await expect(page.getByRole("alert").filter({ hasText: "History temporarily unavailable" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Initial transcript", { exact: true })).toBeVisible();
  const slow = page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "slow");
  await page.getByRole("searchbox").fill("slow");
  await slow;
  await page.getByRole("searchbox").fill("newer result");
  await expect(page.getByText("newer result", { exact: true })).toBeVisible();
  release!();
  await expect(page.getByText("slow", { exact: true })).toHaveCount(0);
});

test("generated audio survives reload, supports private playback/download and deletion", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let saved: Array<{ id: string; kind: "tts" | "clone"; text: string; voice: string; language: string;
    speed: number; duration: number; engine: string; notice: string | null; created_at: string }> = [];
  let fileRequests = 0;
  await setup(page, async (route, url) => {
    const path = url.pathname;
    if (path === "/api/v1/tts") {
      saved.unshift({ id: "speech-1", kind: "tts", text: route.request().postDataJSON().text, voice: "MMS", language: "en",
        speed: 1, duration: 1, engine: "mms", notice: null, created_at: user.created_at });
      await route.fulfill({ contentType: "audio/wav", body: wav(), headers: {
        ...headers, "X-Audio-Id": "speech-1", "Access-Control-Expose-Headers": "X-Audio-Id",
      } });
    } else if (path === "/api/v1/audio") {
      expect(route.request().headers()["authorization"]).toBe("Bearer test-access");
      const kind = url.searchParams.get("kind"), q = url.searchParams.get("q") ?? "";
      const items = saved.filter((item) => (!kind || item.kind === kind) && item.text.includes(q));
      await route.fulfill({ json: { items, total: items.length }, headers });
    } else if (path.endsWith("/file")) {
      expect(route.request().headers()["authorization"]).toBe("Bearer test-access");
      fileRequests++;
      await route.fulfill({ contentType: "audio/wav", body: wav(), headers });
    } else if (path.startsWith("/api/v1/audio/") && route.request().method() === "DELETE") {
      saved = saved.filter((item) => !path.endsWith(item.id));
      await route.fulfill({ status: 204, headers });
    } else return false;
    return true;
  });
  await page.goto("/tts");
  await page.getByLabel("Text to speak").fill("A saved narration for tomorrow");
  await page.getByRole("button", { name: "Generate speech" }).click();
  await expect(page.getByText("Saved to your account.", { exact: false })).toBeVisible();
  await page.goto("/audio");
  await page.reload();
  await expect(page.getByText("A saved narration for tomorrow", { exact: true })).toBeVisible();
  expect(fileRequests).toBe(0); // listing metadata does not download every WAV
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBeGreaterThan(0);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download audio" }).click();
  expect((await download).suggestedFilename()).toBe("bondeth-tts-speech-1.wav");
  expect(fileRequests).toBe(1);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("link", { name: "Download audio" })).toBeVisible();
    if ([320, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`audio-library-${width}.png`), fullPage: true });
  }
  await page.getByRole("radio", { name: "Clones", exact: true }).click();
  await expect(page.getByText("Nothing matches your search.")).toBeVisible();
  await page.getByRole("radio", { name: "All", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search audio" }).fill("tomorrow");
  await expect(page.getByText("1 matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete saved audio" }).click();
  await page.getByRole("button", { name: "Delete audio", exact: true }).click();
  await expect(page.getByText("Nothing matches your search.")).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await expect(page.getByText("No saved audio yet", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("No saved audio yet", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("audio library asks signed-out visitors to sign in", async ({ page }) => {
  await page.route("**/api/v1/usage", (route) => route.fulfill({ json: { signed_in: false, quotas: {} }, headers }));
  await page.goto("/audio");
  await expect(page.getByText("Sign in to continue", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login?next=%2Faudio");
});
