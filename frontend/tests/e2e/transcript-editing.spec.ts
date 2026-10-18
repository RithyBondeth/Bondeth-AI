import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { TranscriptionDetail, TranscriptSegment } from "../../src/lib/types";

const id = "00000000-0000-0000-0000-000000000010";
const user = { id: "editor-user", email: "editor@example.com", full_name: "Editor", email_verified: true, created_at: "2026-10-16T00:00:00Z" };
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,PATCH,POST,OPTIONS" };
const segments: TranscriptSegment[] = [
  { start: 0.125, end: 1.999, text: "សួស្តី" }, { start: 2.0, end: 4.2, text: "Hello world" },
];

async function setup(page: Page, timed = true) {
  const server = {
    document: { id, language_code: "km", transcribed_text: "សួស្តី Hello world", audio_duration_seconds: 4.2,
      created_at: user.created_at, segments: timed ? segments : null, segmented_text: "សួស្តី Hello world",
      revision: 1, updated_at: null } as TranscriptionDetail,
    patches: [] as Array<{ revision: number; segments?: TranscriptSegment[]; text?: string }>,
    fail: false, beforePatch: null as (() => Promise<void>) | null,
  };
  await page.addInitScript((value) => localStorage.setItem("bondeth.session", JSON.stringify({ access: "editor-access", refresh: "refresh", user: value })), user);
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/v1/transcriptions/${id}`) {
      expect(route.request().headers()["authorization"]).toBe("Bearer editor-access");
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        server.patches.push(body);
        if (server.beforePatch) await server.beforePatch();
        if (server.fail) return route.fulfill({ status: 503, json: { detail: "Saving temporarily unavailable" }, headers });
        if (body.revision !== server.document.revision) return route.fulfill({ status: 409, json: { detail: "Changed elsewhere" }, headers });
        server.document = { ...server.document, segments: body.segments ?? null,
          transcribed_text: body.segments ? body.segments.map((s: TranscriptSegment) => s.text.trim()).filter(Boolean).join(" ") : body.text,
          segmented_text: null, revision: server.document.revision + 1, updated_at: user.created_at };
      }
      return route.fulfill({ json: server.document, headers });
    }
    const json = path.endsWith("/auth/me") ? user : path === "/api/v1/transcriptions"
      ? { items: [server.document], total: 1 } : { signed_in: true, quotas: {} };
    await route.fulfill({ json, headers });
  });
  return server;
}

async function openEditor(page: Page) {
  await page.goto("/history");
  await page.getByRole("link", { name: "Edit transcript", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
}

async function download(page: Page, format: "TXT" | "SRT" | "VTT") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
  const result = await pending;
  expect(result.suggestedFilename()).toBe(`transcript.${format.toLowerCase()}`);
  return readFile((await result.path())!, "utf8");
}

test("edits autosave with original timing, reopen after reload, and export the latest draft", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const server = await setup(page);
  await openEditor(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("សួស្តី បណ្ឌិត");
  // Export immediately, even before the debounce saves to the server.
  const srt = await download(page, "SRT");
  expect(srt).toBe("1\n00:00:00,125 --> 00:00:01,999\nសួស្តី បណ្ឌិត\n\n2\n00:00:02,000 --> 00:00:04,200\nHello world\n");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(server.document.segments).toEqual([{ ...segments[0], text: "សួស្តី បណ្ឌិត" }, segments[1]]);
  expect(server.patches[0].revision).toBe(1);
  expect(await download(page, "VTT")).toBe("WEBVTT\n\n" + srt.replaceAll(",125", ".125").replaceAll(",999", ".999").replaceAll(",000", ".000").replaceAll(",200", ".200"));
  expect(await download(page, "TXT")).toBe("សួស្តី បណ្ឌិត Hello world");
  await page.reload();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Segment 1 text", exact: true })).toHaveValue("សួស្តី បណ្ឌិត");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Download SRT", exact: true })).toBeVisible();
    if ([320, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`transcript-editor-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("typing during an in-flight save is serialized without replacing newer text", async ({ page }) => {
  const server = await setup(page);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  server.beforePatch = async () => { if (server.patches.length === 1) await gate; };
  await openEditor(page);
  const firstSave = page.waitForRequest((request) => request.method() === "PATCH");
  const text = page.getByRole("textbox", { name: "Segment 1 text", exact: true });
  await text.fill("First draft");
  await firstSave;
  await text.fill("Newer draft typed while saving");
  release!();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(text).toHaveValue("Newer draft typed while saving");
  expect(server.document.segments![0].text).toBe("Newer draft typed while saving");
  expect(server.patches.map((patch) => patch.revision)).toEqual([1, 2]);
});

test("a failed save retains its draft when leaving and returning, then retries", async ({ page }) => {
  const server = await setup(page);
  server.fail = true;
  await openEditor(page);
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("Keep my unsaved correction");
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Back to history", exact: true }).click();
  await page.getByRole("link", { name: "Edit transcript", exact: true }).click();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Segment 1 text", exact: true })).toHaveValue("Keep my unsaved correction");
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  server.fail = false;
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(server.document.segments![0].text).toBe("Keep my unsaved correction");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("bondeth.transcript-draft")))).toEqual([]);
});

test("conflicting edits preserve the draft until the user chooses a version", async ({ page }) => {
  const server = await setup(page);
  await openEditor(page);
  const text = page.getByRole("textbox", { name: "Segment 1 text", exact: true });
  server.document = { ...server.document, revision: 2, segments: [{ ...segments[0], text: "Other tab" }, segments[1]], transcribed_text: "Other tab Hello world" };
  await text.fill("My draft");
  await expect(page.getByRole("button", { name: "Load saved version", exact: true })).toBeVisible();
  await expect(text).toHaveValue("My draft");
  expect(server.document.segments![0].text).toBe("Other tab");
  await page.getByRole("button", { name: "Load saved version", exact: true }).click();
  await expect(text).toHaveValue("Other tab");
  server.document = { ...server.document, revision: 3 };
  await text.fill("My explicit version");
  await expect(page.getByRole("button", { name: "Save my version", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save my version", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(server.document.segments![0].text).toBe("My explicit version");
  expect(server.document.revision).toBe(4);
});

test("older transcripts autosave plain text and explain unavailable subtitle timing", async ({ page }) => {
  const server = await setup(page, false);
  await openEditor(page);
  await expect(page.getByText(/Timestamps aren't available/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download SRT", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download VTT", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Transcript text", exact: true }).fill("Corrected legacy ខ្មែរ");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(server.document.transcribed_text).toBe("Corrected legacy ខ្មែរ");
  expect(await download(page, "TXT")).toBe("Corrected legacy ខ្មែរ");
});

test("subtitle export escapes markup and skips empty cues", async ({ page }) => {
  await setup(page);
  await openEditor(page);
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("");
  await page.getByRole("textbox", { name: "Segment 2 text", exact: true }).fill("ខ្មែរ & <b>literal</b> -->\n\nnext line");
  const vtt = await download(page, "VTT");
  expect(vtt).toBe("WEBVTT\n\n1\n00:00:02.000 --> 00:00:04.200\nខ្មែរ &amp; &lt;b&gt;literal&lt;/b&gt; --&gt;\nnext line\n");
  const cues = await page.evaluate(async (content) => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/vtt" }));
    const video = document.createElement("video");
    const track = document.createElement("track");
    const loaded = new Promise<void>((resolve, reject) => {
      track.onload = () => resolve(); track.onerror = () => reject(new Error("Invalid WebVTT"));
    });
    track.kind = "subtitles"; track.src = url;
    video.append(track); document.body.append(video); track.track.mode = "hidden";
    try {
      await loaded;
      return Array.from(track.track.cues ?? []).map((cue) => ({ start: cue.startTime, end: cue.endTime,
        text: (cue as VTTCue).getCueAsHTML().textContent }));
    } finally { video.remove(); URL.revokeObjectURL(url); }
  }, vtt);
  expect(cues).toEqual([{ start: 2, end: 4.2, text: "ខ្មែរ & <b>literal</b> -->\nnext line" }]);
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
});

test("anonymous live dictation keeps its timings for local editing and export", async ({ page }) => {
  const patches: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "PATCH") patches.push(route.request().url());
    await route.fulfill({ json: { signed_in: false, quotas: {} }, headers });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const target = context.createMediaStreamDestination();
      oscillator.connect(target); oscillator.start(); await context.resume();
      const track = target.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      return target.stream;
    } });
  });
  await page.routeWebSocket("**/api/v1/stt/live", (socket) => socket.onMessage((message) => {
    if (typeof message !== "string") return;
    const data = JSON.parse(message);
    if (data.type === "start") socket.send(JSON.stringify({ type: "ready" }));
    if (data.type === "stop") {
      socket.send(JSON.stringify({ type: "done", text: "សួស្តី Hello world", segmented_text: "សួស្តី Hello world",
        language: "km", duration: 4.2, transcription_id: null, segments }));
      socket.close();
    }
  }));
  await page.goto("/stt");
  await page.getByRole("button", { name: "Start dictation", exact: true }).click();
  await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Session only$/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("Local correction");
  expect(await download(page, "SRT")).toContain("00:00:00,125 --> 00:00:01,999\nLocal correction");
  expect(patches).toEqual([]);
});

async function saved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function timing(page: Page, number: number, start: string, end: string) {
  await page.getByRole("button", { name: `Edit timing for segment ${number}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Start time", exact: true }).fill(start);
  await dialog.getByRole("textbox", { name: "End time", exact: true }).fill(end);
  await dialog.getByRole("button", { name: "Apply timing", exact: true }).click();
}

test("timing changes autosave and export immediately, survive reload, and support undo after saving", async ({ page }) => {
  const server = await setup(page); await openEditor(page);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await timing(page, 1, "00:00:00.250", "1.75");
  expect(await download(page, "SRT")).toContain("00:00:00,250 --> 00:00:01,750");
  expect(await download(page, "VTT")).toContain("00:00:00.250 --> 00:00:01.750");
  await saved(page);
  expect(server.document.segments![0]).toEqual({ ...segments[0], start: .25, end: 1.75 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect(server.document.segments).toEqual(segments);
  expect(server.document.revision).toBe(3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  expect(server.document.revision).toBe(4);
  await page.reload();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  expect(await download(page, "VTT")).toContain("00:00:00.250 --> 00:00:01.750");
});

test("split at the caret and merge preserve text, subtitle ranges, and reversible autosaved steps", async ({ page }) => {
  const server = await setup(page); await openEditor(page);
  const second = page.getByRole("textbox", { name: "Segment 2 text", exact: true });
  await second.focus(); await second.press("Home");
  for (let i = 0; i < 6; i++) await second.press("ArrowRight");
  await page.getByRole("button", { name: "Split segment 2", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "First part", exact: true })).toHaveValue("Hello ");
  await expect(dialog.getByRole("textbox", { name: "Second part", exact: true })).toHaveValue("world");
  await dialog.getByRole("textbox", { name: "Split time", exact: true }).fill("3.25");
  await dialog.getByRole("button", { name: "Apply split", exact: true }).click();
  const split = [segments[0], { start: 2, end: 3.25, text: "Hello " }, { start: 3.25, end: 4.2, text: "world" }];
  await saved(page); expect(server.document.segments).toEqual(split);
  expect(await download(page, "SRT")).toContain("2\n00:00:02,000 --> 00:00:03,250\nHello\n\n3\n00:00:03,250 --> 00:00:04,200\nworld");
  await page.getByRole("button", { name: "Merge segment 2 with next", exact: true }).click();
  await saved(page); expect(server.document.segments).toEqual(segments);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page); expect(server.document.segments).toEqual(split);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page); expect(server.document.segments).toEqual(segments);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page); expect(server.document.segments).toEqual(split);
  await page.getByRole("textbox", { name: "Segment 3 text", exact: true }).fill("new branch");
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await saved(page);
  expect(server.patches.map((p) => p.revision)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("invalid timing and split boundaries never mutate or autosave the transcript", async ({ page }) => {
  const server = await setup(page); await openEditor(page);
  for (const [start, end, message] of [
    ["invalid", "1", "Enter a time as"], ["-1", "1", "Enter a time as"],
    ["1", "1", "End time must"], ["1", "0.5", "End time must"],
    ["0", "5", "Subtitle timing exceeds"], ["2.5", "3", "Segments must stay ordered"],
  ]) {
    await timing(page, 1, start, end);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(message);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await page.getByRole("button", { name: "Split segment 1", exact: true }).click();
  await page.getByRole("textbox", { name: "Split time", exact: true }).fill("0.125");
  await page.getByRole("button", { name: "Apply split", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Split time must be inside");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(server.patches).toEqual([]); expect(server.document.segments).toEqual(segments);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("undo during a structural save keeps newer typing and serializes the restored draft", async ({ page }) => {
  const server = await setup(page); await openEditor(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  server.beforePatch = async () => { if (server.patches.length === 1) await gate; };
  const sent = page.waitForRequest((r) => r.method() === "PATCH");
  await timing(page, 1, "0.25", "1.75");
  await sent;
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("textbox", { name: "Segment 1 text", exact: true }).fill("Typed after undo");
  release(); await saved(page);
  expect(server.document.segments).toEqual([{ ...segments[0], text: "Typed after undo" }, segments[1]]);
  expect(server.patches.map((p) => p.revision)).toEqual([1, 2]);
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});

test("keyboard undo and redo cover plain text and clear when loading another saved version", async ({ page }) => {
  const server = await setup(page, false); await openEditor(page);
  const text = page.getByRole("textbox", { name: "Transcript text", exact: true });
  await text.fill("Changed plain text"); await saved(page);
  await text.press("ControlOrMeta+z");
  await expect(text).toHaveValue("សួស្តី Hello world"); await saved(page);
  await text.press("ControlOrMeta+Shift+z");
  await expect(text).toHaveValue("Changed plain text"); await saved(page);
  server.document = { ...server.document, revision: server.document.revision + 1, transcribed_text: "Remote version" };
  await text.fill("Conflicting edit");
  await page.getByRole("button", { name: "Load saved version", exact: true }).click();
  await expect(text).toHaveValue("Remote version");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});

test("Khmer timing and split dialogs fit small screens, trap focus, and preserve canceled text", async ({ page }, info) => {
  const server = await setup(page); await openEditor(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole("button", { name: /Switch to Khmer/ }).click();
  await page.getByRole("button", { name: "កែពេលវេលាផ្នែកទី 1", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(page.getByText(/Edit text and timing, split at the text cursor/)).toHaveCount(0);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`timing-dialog-${width}.png`), fullPage: true });
  }
  const first = dialog.getByRole("button", { name: "បិទ", exact: true });
  await first.focus(); await first.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "អនុវត្តពេលវេលា", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "បំបែកផ្នែកទី 1", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "ផ្នែកទីមួយ", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "បោះបង់", exact: true }).click();
  expect(server.patches).toEqual([]);
});

test("a failed split save retains every boundary when leaving and returning, then retries", async ({ page }) => {
  const server = await setup(page); server.fail = true; await openEditor(page);
  await page.getByRole("button", { name: "Split segment 2", exact: true }).click();
  await page.getByRole("textbox", { name: "Split time", exact: true }).fill("3.125");
  await page.getByRole("textbox", { name: "First part", exact: true }).fill("Hello");
  await page.getByRole("textbox", { name: "Second part", exact: true }).fill("world");
  await page.getByRole("button", { name: "Apply split", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  const srt = await download(page, "SRT");
  expect(srt).toContain("00:00:03,125 --> 00:00:04,200\nworld");
  await page.getByRole("link", { name: "← Back to history", exact: true }).click();
  await page.getByRole("link", { name: "Edit transcript", exact: true }).click();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Segment 3 text", exact: true })).toHaveValue("world");
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  expect(await download(page, "SRT")).toBe(srt);
  server.fail = false;
  await page.getByRole("button", { name: "Retry save", exact: true }).click(); await saved(page);
  expect(server.document.segments).toEqual([segments[0], { start: 2, end: 3.125, text: "Hello" }, { start: 3.125, end: 4.2, text: "world" }]);
});
