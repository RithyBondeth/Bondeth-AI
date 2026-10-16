import { expect, test } from "@playwright/test";

function wav(rate: number) {
  const data = Buffer.alloc(44 + rate * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < rate; i++) data.writeInt16LE(Math.round(6000 * Math.sin(i * 220 * 2 * Math.PI / rate)), 44 + i * 2);
  return data;
}

test("labels fallback persistently, plays it, and keeps OmniVoice as the main voice", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().startsWith("You have Reduced Motion enabled")) return;
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  let generation = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Expose-Headers": "X-TTS-Engine,X-TTS-Fallback,X-Cache" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/api/v1/tts") {
      generation++;
      expect(route.request().postDataJSON()).toMatchObject({ text: "សួស្តី", lang: "km" });
      const fallback = generation === 1;
      return route.fulfill({ contentType: "audio/wav", body: wav(fallback ? 16000 : 24000), headers: {
        ...headers, "X-TTS-Engine": fallback ? "mms" : "omnivoice",
        "X-TTS-Fallback": fallback ? "short-khmer-omni-failed" : "none", "X-Cache": fallback ? "BYPASS" : "HIT",
      } });
    }
    const json = path === "/api/v1/tts/preview"
      ? { engine: "omnivoice", primary_lang: "km", chunks: [{ lang: "km", text: "សួស្តី" }] }
      : { signed_in: false, account: "anonymous", plan: "free", quotas: {} };
    await route.fulfill({ json, headers });
  });
  await page.goto("/tts");
  await page.getByRole("radio", { name: "ខ្មែរ", exact: true }).click();
  await expect(page.getByRole("radio", { name: "ខ្មែរ", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Text to speak").fill("សួស្តី");
  await expect(page.getByText("OmniVoice · main voice")).toBeVisible();
  await page.getByRole("button", { name: "Generate speech" }).click();
  await expect(page.getByRole("status").filter({ hasText: "a different speaker" })).toBeVisible();
  await expect(page.getByText(/MMS fallback — different voice/)).toBeVisible();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Download audio" })).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 320 || width === 1440) await page.screenshot({ path: info.outputPath(`tts-fallback-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Generate speech" }).click();
  await expect(page.locator("audio")).toHaveCount(2);
  await expect(page.getByText(/MMS fallback — different voice/)).toBeVisible();
  await expect(page.getByText(/· OmniVoice$/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "a different speaker" })).toHaveCount(1);
  expect(errors).toEqual([]);
});
