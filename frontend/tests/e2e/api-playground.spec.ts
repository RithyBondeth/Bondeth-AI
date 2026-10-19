import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: { signed_in: false, quotas: {} } }));
});

test("preview validates JSON locally, sends only on demand, and displays real response details", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/v1/tts/preview", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ text: "Test preview", lang: "en" });
    await route.fulfill({ json: { chunks: [{ text: "Test preview" }] }, headers: { "X-Cache": "MISS", "Access-Control-Expose-Headers": "X-Cache" } });
  });
  await page.goto("/api#try-it");
  const panel = page.locator("#try-it");
  await expect(panel.getByLabel("Endpoint", { exact: true })).toHaveValue("speech-preview");
  expect(requests).toBe(0);
  await panel.getByLabel("JSON request body").fill("{oops}");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("valid JSON object");
  expect(requests).toBe(0);
  await panel.getByLabel("JSON request body").fill('{"text":"Test preview","lang":"en"}');
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("HTTP 200");
  await expect(panel.getByLabel("Response body", { exact: true })).toContainText("Test preview");
  await panel.getByText("Response headers", { exact: true }).click();
  await expect(panel).toContainText("x-cache: MISS");
  expect(requests).toBe(1);
});

test("API keys stay in memory and HTTP errors remain visible without automatic retries", async ({ page }) => {
  const auth: Array<{ key?: string; bearer?: string }> = [];
  await page.route("**/api/v1/voices", async (route) => {
    auth.push({ key: route.request().headers()["x-api-key"], bearer: route.request().headers().authorization });
    await route.fulfill({ status: 401, json: { detail: "Invalid test key" } });
  });
  await page.goto("/api#try-it");
  const panel = page.locator("#try-it");
  await panel.getByLabel("Endpoint", { exact: true }).selectOption("saved-voices");
  await panel.getByLabel("Request authentication").selectOption("key");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Enter an API key");
  expect(auth).toHaveLength(0);
  await panel.getByLabel("API key", { exact: true }).fill("bdk_test_playground");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("HTTP 401");
  await expect(panel.getByLabel("Response body", { exact: true })).toContainText("Invalid test key");
  expect(auth).toEqual([{ key: "bdk_test_playground", bearer: undefined }]);
  expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain("bdk_test_playground");
  await panel.getByLabel("Request authentication").selectOption("anonymous");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect.poll(() => auth.length).toBe(2);
  expect(auth[1]).toEqual({ key: undefined, bearer: undefined });
  await panel.getByLabel("Request authentication").selectOption("key");
  await expect(panel.getByLabel("API key", { exact: true })).toHaveValue("");
});

test("transcription sends a multipart file and selected language", async ({ page }) => {
  let body = "";
  await page.route("**/api/v1/stt", async (route) => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
    body = route.request().postDataBuffer()!.toString();
    await route.fulfill({ json: { text: "Transcribed test" } });
  });
  await page.goto("/api#try-it");
  const panel = page.locator("#try-it");
  await panel.getByLabel("Endpoint", { exact: true }).selectOption("speech-to-text");
  await panel.getByLabel("Audio file", { exact: true }).setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.from("test audio") });
  await panel.getByLabel("Language", { exact: true }).selectOption("km");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByLabel("Response body", { exact: true })).toContainText("Transcribed test");
  expect(body).toContain('name="file"; filename="sample.wav"');
  expect(body).toContain('name="language"\r\n\r\nkm');
  expect(body).not.toContain('name="keep_source_audio"');
});

test("the current session uses its access token and saved voices exclude reference uploads", async ({ page }) => {
  const user = { id: "test-user", email: "playground@example.test", full_name: "Playground", email_verified: true, created_at: "2026-10-19T00:00:00Z" };
  await page.addInitScript((user) => localStorage.setItem("bondeth.session", JSON.stringify({ access: "test-session-token", refresh: "test-refresh", user })), user);
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: user }));
  let requestBody = "";
  await page.route("**/api/v1/clone", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer test-session-token");
    expect(route.request().headers()["x-api-key"]).toBeUndefined();
    requestBody = route.request().postDataBuffer()!.toString();
    await route.fulfill({ status: 202, json: { job_id: "saved-voice-job", status: "queued" } });
  });
  await page.goto("/api#try-it");
  const panel = page.locator("#try-it");
  await panel.getByLabel("Endpoint", { exact: true }).selectOption("voice-cloning");
  await panel.getByLabel("Voice source", { exact: true }).selectOption("saved");
  await panel.getByLabel("Saved voice ID", { exact: true }).fill("11111111-1111-4111-8111-111111111111");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("HTTP 202");
  expect(requestBody).toContain('name="voice_id"');
  expect(requestBody).not.toContain('name="reference_audio"');
  expect(requestBody).not.toContain('name="consent"');
});

test("cloning requires consent and follows only fixed same-API job paths for status and audio", async ({ page }) => {
  const paths: string[] = [];
  await page.route("**/api/v1/clone**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path.endsWith("/audio")) {
      const wav = Buffer.alloc(46);
      wav.write("RIFF"); wav.writeUInt32LE(38, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
      wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
      wav.write("data", 36); wav.writeUInt32LE(2, 40);
      await route.fulfill({ contentType: "audio/wav", body: wav });
    } else await route.fulfill({ status: path.endsWith("/clone") ? 202 : 200,
      json: { job_id: "test-job", status: path.endsWith("/clone") ? "queued" : "done",
        status_url: "https://untrusted.invalid/status", audio_url: "https://untrusted.invalid/audio" } });
  });
  await page.goto("/api#try-it");
  const panel = page.locator("#try-it");
  await panel.getByLabel("Endpoint", { exact: true }).selectOption("voice-cloning");
  await panel.getByLabel("Reference audio", { exact: true }).setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: Buffer.from("test reference") });
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  expect(paths).toHaveLength(0);
  await panel.getByRole("checkbox", { name: /my voice/ }).check();
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("HTTP 202");
  await panel.getByRole("button", { name: "Check job status" }).click();
  await panel.getByRole("button", { name: "Get job audio" }).click();
  await expect(panel.getByRole("link", { name: /Download/ })).toBeVisible();
  expect(paths).toEqual(["/api/v1/clone", "/api/v1/clone/jobs/test-job", "/api/v1/clone/jobs/test-job/audio"]);
  await expect(panel.locator("audio[autoplay]")).toHaveCount(0);
});

test("endpoint documentation links preselect the request and pending requests can be cancelled", async ({ page }) => {
  await page.route("**/api/v1/tts/preview", () => { /* Leave pending until the user cancels. */ });
  await page.goto("/api#try-it");
  const panel = page.locator("#try-it");
  await panel.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(panel.getByText("Waiting for the API response…")).toBeVisible();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Request cancelled");
  await expect(panel.getByRole("button", { name: "Send request", exact: true })).toBeEnabled();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "Usage and limits", exact: true }) }).getByRole("link", { name: /Try this endpoint/ }).click();
  await expect(panel.getByLabel("Endpoint", { exact: true })).toHaveValue("usage");
  await expect(panel).toContainText("This endpoint has no request body.");
});
