import { expect, test, type Page } from "@playwright/test";
import type { TranscriptionDetail } from "../../src/lib/types";

const id = "00000000-0000-0000-0000-000000000010";
const user = { id: "audio-editor", email: "editor@example.com", full_name: "Editor", email_verified: true, created_at: "2026-10-18T00:00:00Z" };
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PATCH,DELETE,POST,OPTIONS" };
function wav() {
  const data = Buffer.alloc(44 + 32000 * 8);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
async function setup(page: Page, status: TranscriptionDetail["source_audio_status"] = "available") {
  const server = { requests: 0, deleted: false, fail: false, patches: 0,
    document: { id, language_code: "en", transcribed_text: "First phrase Second phrase", audio_duration_seconds: 8,
      created_at: user.created_at, segments: [{ start: 0, end: 2, text: "First phrase" }, { start: 4, end: 6, text: "Second phrase" }],
      segmented_text: null, revision: 1, updated_at: null, source_audio_status: status } as TranscriptionDetail };
  await page.addInitScript((user) => localStorage.setItem("bondeth.session", JSON.stringify({ access: "private-token", refresh: "refresh", user })), user);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname;
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.endsWith("/source-audio")) {
      expect(request.headers().authorization).toBe("Bearer private-token");
      expect(request.url()).not.toContain("private-token");
      if (method === "DELETE") { server.deleted = true; server.document.source_audio_status = "removed"; return route.fulfill({ status: 204, headers }); }
      server.requests++;
      return server.fail ? route.fulfill({ status: 503, json: { detail: "Couldn't load source audio." }, headers })
        : route.fulfill({ body: wav(), contentType: "audio/wav", headers });
    }
    if (path === `/api/v1/transcriptions/${id}`) {
      if (method === "PATCH") {
        server.patches++;
        const body = request.postDataJSON();
        if (body.revision !== server.document.revision) return route.fulfill({ status: 409, json: { detail: "Changed elsewhere" }, headers });
        server.document = { ...server.document, segments: body.segments, transcribed_text: body.segments.map((s: {text: string}) => s.text).join(" "), revision: server.document.revision + 1 };
      }
      return route.fulfill({ json: server.document, headers });
    }
    return route.fulfill({ json: path.endsWith("/auth/me") ? user : path === "/api/v1/transcriptions" ? { items: [server.document], total: 1 } : { signed_in: true, quotas: {} }, headers });
  });
  await page.goto(`/history/${id}`);
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  return server;
}

test("authenticated lazy playback seeks, highlights, pauses and keeps edits while changing language", async ({ page }, info) => {
  const server = await setup(page);
  expect(server.requests).toBe(0);
  const second = page.getByRole("button", { name: "Play segment 2", exact: true });
  await second.click();
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Pause source audio", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause source audio", exact: true }).click();
  const audio = page.locator("audio");
  expect(await audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThanOrEqual(4);
  await page.getByLabel("Playback speed", { exact: true }).selectOption("1.5");
  expect(await audio.evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(1.5);
  const position = page.getByRole("slider", { name: "Source audio position", exact: true });
  await position.fill("3");
  await expect(page.locator('button[aria-current="true"]')).toHaveCount(0); // silence between cues
  await position.fill("1");
  await expect(page.getByRole("button", { name: "Play segment 1", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Segment 1 text", exact: true });
  await text.fill("Corrected phrase");
  await page.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expect(text).toHaveValue("Corrected phrase");
  await page.getByRole("button", { name: /Switch to Khmer/ }).click();
  await expect(page.getByRole("button", { name: "ផ្អាកសំឡេងដើម", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox").first()).toHaveValue("Corrected phrase");
  await expect.poll(() => server.patches).toBe(1);
  expect(server.requests).toBe(1);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    if (width !== 768) await page.screenshot({ path: info.outputPath(`source-editor-${width}.png`), fullPage: true });
  }
  await page.goto("/history");
  expect(await page.locator("audio").count()).toBe(0);
});

test("playback follows time through gaps and clears at the end", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Play source audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 1", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("slider", { name: "Source audio position", exact: true }).fill("3.5");
  await expect(page.getByRole("button", { name: "Play segment 2", exact: true })).toHaveAttribute("aria-current", "true", { timeout: 3000 });
  await page.getByRole("slider", { name: "Source audio position", exact: true }).fill("7.9");
  await expect(page.getByRole("button", { name: "Play source audio", exact: true })).toBeVisible();
  await expect(page.locator('button[aria-current="true"]')).toHaveCount(0);
});

test("failed fetch retries and deleting the recording preserves transcript editing", async ({ page }) => {
  const server = await setup(page); server.fail = true;
  await page.getByRole("button", { name: "Play source audio", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load source audio." })).toBeVisible();
  server.fail = false;
  await page.getByRole("button", { name: "Play source audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause source audio", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete source audio", exact: true }).click();
  await page.getByRole("button", { name: "Remove recording", exact: true }).click();
  await expect(page.getByText("Source audio was deleted. Your transcript and subtitles are still available.", { exact: true })).toBeVisible();
  expect(server.deleted).toBe(true);
  await expect(page.getByRole("button", { name: "Download SRT", exact: true })).toBeEnabled();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Segment 1 text", exact: true })).toHaveValue("First phrase");
  expect(server.requests).toBe(2);
});

test("older transcripts remain editable without requesting audio", async ({ page }) => {
  const server = await setup(page, "not_saved");
  await expect(page.getByText("No source audio was saved for this transcript.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play source audio", exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("Still editable");
  await expect.poll(() => server.patches).toBe(1);
  expect(server.requests).toBe(0);
});

test("upload retention follows the signed-in user's checkbox", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/stt/jobs", (route) => route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers })
    : route.fulfill({ status: 503, json: { detail: "Test queue unavailable" }, headers }));
  await page.goto("/stt");
  const keep = page.getByRole("checkbox", { name: /Keep source audio/ });
  await expect(keep).toBeChecked();
  await page.getByRole("radio", { name: "Record or upload", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "source.wav", mimeType: "audio/wav", buffer: wav() });
  for (const retained of [true, false]) {
    await keep.setChecked(retained);
    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/stt/jobs"));
    await page.getByRole("button", { name: "Transcribe", exact: true }).click();
    const request = await sent;
    expect(request.headers().authorization).toBe("Bearer private-token");
    expect(request.postData()).toMatch(new RegExp(`name="keep_source_audio"\\r?\\n\\r?\\n${retained}`));
    await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeEnabled();
  }
});

test("signing out in another tab stops playback and revokes its private blob URL", async ({ page }) => {
  await page.addInitScript(() => {
    const revoked: string[] = [], original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { revoked.push(url); original(url); };
    Object.assign(window, { revokedSourceUrls: revoked });
  });
  await setup(page);
  await page.getByRole("button", { name: "Play source audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause source audio", exact: true })).toBeVisible();
  const element = (await page.locator("audio").elementHandle())!;
  const src = await element.getAttribute("src");
  expect(src).toMatch(/^blob:/);
  await page.evaluate(() => {
    localStorage.removeItem("bondeth.session");
    window.dispatchEvent(new StorageEvent("storage", { key: "bondeth.session", newValue: null }));
  });
  await expect(page.getByText("Sign in to continue", { exact: true })).toBeVisible();
  expect(await element.evaluate((el: HTMLAudioElement) => el.paused && !el.getAttribute("src"))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as {revokedSourceUrls: string[]}).revokedSourceUrls)).toContain(src);
});

test("playback position sets timing and highlighting stays correct after merge, split and undo", async ({ page }) => {
  const server = await setup(page);
  await page.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await page.getByRole("button", { name: "Pause source audio", exact: true }).click();
  await page.getByRole("slider", { name: "Source audio position", exact: true }).fill("4.5");
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Edit timing for segment 2", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Use playback for start", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Start time", exact: true })).toHaveValue("00:00:04.500");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Apply timing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 2", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Merge segment 1 with next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 1", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 2", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Split segment 2", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Split time", exact: true }).fill("5.25");
  await dialog.getByRole("button", { name: "Apply split", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 2", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("slider", { name: "Source audio position", exact: true }).fill("5.5");
  await expect(page.getByRole("button", { name: "Play segment 3", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 2", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(server.document.segments![1].start).toBe(4.5);
  expect(server.requests).toBe(1);
});

test("loading a remotely retimed version clears local undo and refreshes paused highlighting", async ({ page }) => {
  const server = await setup(page);
  await page.getByRole("button", { name: "Play segment 1", exact: true }).click();
  await page.getByRole("button", { name: "Pause source audio", exact: true }).click();
  await page.getByRole("slider", { name: "Source audio position", exact: true }).fill("1");
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 1", exact: true })).toHaveAttribute("aria-current", "true");
  server.document = { ...server.document, revision: 2, transcribed_text: "Remote first Second phrase",
    segments: [{ start: 1.5, end: 2.5, text: "Remote first" }, server.document.segments![1]] };
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("My local correction");
  await page.getByRole("button", { name: "Load saved version", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Segment 1 text", exact: true })).toHaveValue("Remote first");
  await expect(page.locator('button[aria-current="true"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Play segment 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play segment 1", exact: true })).toHaveAttribute("aria-current", "true");
  expect(server.requests).toBe(1);
});
