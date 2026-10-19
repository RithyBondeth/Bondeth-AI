import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { findTranscriptMatches, indexTranscript, replaceTranscriptMatches, replacementError } from "../../src/lib/transcriptSearch";
import { transcriptDraft } from "../../src/lib/subtitles";
import type { TranscriptDraft, TranscriptionDetail, TranscriptSegment } from "../../src/lib/types";

const find = (draft: TranscriptDraft, query: string, matchCase = false) => findTranscriptMatches(indexTranscript(draft, matchCase), query, matchCase);

test("Unicode search maps canonical matches to original text and never splits Khmer or emoji clusters", () => {
  const draft = transcriptDraft("", [{ start: 0, end: 8, text: "សួស្តី café cafe\u0301 👨‍👩‍👧‍👦" }]);
  for (const fragment of ["ស", "ួ", "្ត", "👨", "\u0301"]) expect(find(draft, fragment).matches).toHaveLength(0);
  const canonical = find(draft, "café").matches;
  expect(canonical.map(m => draft.segments![0].text.slice(m.start, m.end))).toEqual(["café", "cafe\u0301"]);
  const result = replaceTranscriptMatches(draft, canonical, "$& [literal]");
  expect(result.segments![0]).toEqual({ start: 0, end: 8, text: "សួស្តី $& [literal] $& [literal] 👨‍👩‍👧‍👦" });
  expect(find(draft, "សួស្តី").matches).toHaveLength(1);
  expect(find(draft, "👨‍👩‍👧‍👦").matches).toHaveLength(1);
  expect(draft.segments![0].text).toContain("cafe\u0301");
});

test("literal non-overlapping search honors case and never joins text across subtitle boundaries", () => {
  const draft = transcriptDraft("", [{ start: 0, end: 1, text: "hello HELLO [a.b] aab" }, { start: 2, end: 3, text: "world" }]);
  expect(find(draft, "hello").matches).toHaveLength(2);
  expect(find(draft, "hello", true).matches).toHaveLength(1);
  expect(find(draft, "[a.b]").matches).toHaveLength(1);
  expect(find(draft, "HELLO [a.b] aab world").matches).toHaveLength(0);
  const repeated = { text: "aaaa", segments: null };
  expect(find(repeated, "aa").matches).toHaveLength(2);
  expect(replaceTranscriptMatches(repeated, find(repeated, "aa").matches, "aaa").text).toBe("aaaaaa");
});

test("replacement limits reject an entire operation before allocating oversized results", () => {
  const draft = transcriptDraft("", [{ start: 0, end: 2, text: "x".repeat(6000) }, { start: 2, end: 4, text: "untouched" }]);
  const matches = find(draft, "x").matches;
  expect(replacementError(draft, matches, "xx")).toContain("10,000");
  expect(() => replaceTranscriptMatches(draft, matches, "xx")).toThrow("10,000");
  expect(replacementError(draft, matches.slice(0, 1), "xx")).toBeNull();
  expect(replacementError(draft, matches, "\0")).toContain("null characters");
  expect(find({ text: "a".repeat(10001), segments: null }, "a")).toEqual({ matches: [], overflow: true });
  const large = { text: "x" + "y".repeat(499999), segments: null };
  expect(replacementError(large, find(large, "x").matches, "xx")).toContain("500,000");
  expect(draft.segments![0].text).toHaveLength(6000);
});

const id = "00000000-0000-0000-0000-000000000019";
const user = { id: "find-user", email: "find@example.com", full_name: "Finder", email_verified: true, created_at: "2026-10-18T00:00:00Z" };
const cues: TranscriptSegment[] = [
  { start: 0, end: 2, text: "Hello សួស្តី Hello" },
  { start: 2.5, end: 4, text: "HELLO café cafe\u0301 សួស្តី" },
  { start: 5, end: 6, text: "Money $& [a.b] 👨‍👩‍👧‍👦" },
  { start: 7, end: 8, text: "សួស្តី Hello" },
];
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PATCH,POST,OPTIONS" };
async function setup(page: Page, timed = true, segments = cues) {
  const server = { document: { id, language_code: "km", transcribed_text: segments.map(s => s.text).join(" "), segments: timed ? segments : null,
    segmented_text: "Model word separated formatting", revision: 1, updated_at: null, audio_duration_seconds: 10,
    created_at: user.created_at, source_audio_status: "not_saved" } as TranscriptionDetail,
    patches: [] as Array<{revision: number; segments?: TranscriptSegment[]; text?: string}>, fail: false,
    beforePatch: null as (() => Promise<void>) | null };
  await page.addInitScript((user) => localStorage.setItem("bondeth.session", JSON.stringify({ access: "find-token", refresh: "refresh", user })), user);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === `/api/v1/transcriptions/${id}`) {
      expect(request.headers().authorization).toBe("Bearer find-token");
      if (request.method() === "PATCH") {
        const body = request.postDataJSON(); server.patches.push(body);
        if (server.beforePatch) await server.beforePatch();
        if (server.fail) return route.fulfill({ status: 503, json: { detail: "Saving temporarily unavailable" }, headers });
        if (body.revision !== server.document.revision) return route.fulfill({ status: 409, json: { detail: "Changed elsewhere" }, headers });
        server.document = { ...server.document, segments: body.segments ?? null, segmented_text: null,
          transcribed_text: body.segments ? body.segments.map((s: TranscriptSegment) => s.text.trim()).filter(Boolean).join(" ") : body.text,
          revision: server.document.revision + 1 };
      }
      return route.fulfill({ json: server.document, headers });
    }
    return route.fulfill({ json: path.endsWith("/auth/me") ? user : path === "/api/v1/transcriptions"
      ? { items: [server.document], total: 1 } : { signed_in: true, quotas: {} }, headers });
  });
  await page.goto(`/history/${id}`); await saved(page);
  return server;
}
async function saved(page: Page) { await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible(); }
async function search(page: Page, query: string) {
  await page.getByRole("button", { name: "Find and replace", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in transcript", exact: true }).fill(query);
}
async function download(page: Page, format: "SRT" | "VTT" | "TXT") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}
const marks = (page: Page) => page.locator("mark[data-search-match]");
const current = (page: Page) => page.locator('mark[data-search-current="true"]');

test("find highlights literal matches in all transcript views and supports navigation, case, and keyboard focus", async ({ page }) => {
  const server = await setup(page); await search(page, "hello");
  await expect(marks(page)).toHaveCount(4);
  await expect(page.getByRole("status").filter({ hasText: "Match 1 of 4" })).toBeVisible();
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect(current(page)).toHaveAttribute("data-search-match", "1");
  await page.getByRole("button", { name: "Previous match", exact: true }).click();
  await expect(current(page)).toHaveAttribute("data-search-match", "0");
  const query = page.getByRole("searchbox", { name: "Find in transcript", exact: true });
  await query.focus(); await query.press("Shift+Enter");
  await expect(current(page)).toHaveAttribute("data-search-match", "3");
  await expect(query).toBeFocused();
  await page.getByRole("checkbox", { name: "Match case", exact: true }).check();
  await expect(marks(page)).toHaveCount(0); // Lower-case query is absent with case matching.
  await query.fill("Hello"); await expect(marks(page)).toHaveCount(3);
  await page.getByRole("radio", { name: "Timeline", exact: true }).click(); await expect(marks(page)).toHaveCount(3);
  await page.getByRole("radio", { name: "Edit", exact: true }).click(); await expect(marks(page)).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Segment 1 text", exact: true })).toHaveValue(cues[0].text);
  await page.getByRole("button", { name: "Close find and replace", exact: true }).click(); await expect(marks(page)).toHaveCount(0);
  const text = page.getByRole("textbox", { name: "Segment 1 text", exact: true });
  await text.focus(); await text.press("ControlOrMeta+f"); await expect(query).toBeFocused();
  await query.press("Escape"); await expect(text).toBeFocused();
  expect(server.patches).toHaveLength(0);
});

test("replace all is one undoable autosaved change with identical timing and current SRT/VTT exports", async ({ page }) => {
  const server = await setup(page); await search(page, "hello");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("World");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(marks(page)).toHaveCount(0);
  const srt = await download(page, "SRT");
  expect(srt).toContain("00:00:00,000 --> 00:00:02,000\nWorld សួស្តី World");
  expect(srt).not.toMatch(/hello/i);
  const vtt = await download(page, "VTT"); expect(vtt).toContain("00:00:02.500 --> 00:00:04.000");
  await saved(page); expect(server.patches).toHaveLength(1);
  expect(server.document.segments!.map(({start, end}) => ({start, end}))).toEqual(cues.map(({start, end}) => ({start, end})));
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved(page);
  expect(server.document.segments).toEqual(cues);
  await expect(marks(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await saved(page);
  expect(server.patches.map(p => p.revision)).toEqual([1, 2, 3]);
  await page.reload(); expect(await download(page, "SRT")).toBe(srt);
});

test("replace one advances past inserted matches; empty replacements delete complete matches", async ({ page }) => {
  const server = await setup(page); await search(page, "Hello");
  const replacement = page.getByRole("textbox", { name: "Replace with", exact: true });
  await replacement.fill("HelloHello");
  await page.getByRole("button", { name: "Replace one", exact: true }).click();
  await expect(marks(page)).toHaveCount(5);
  await expect(page.getByRole("status").filter({ hasText: "Match 3 of 5" })).toBeVisible();
  await replacement.fill(""); await page.getByRole("button", { name: "Replace one", exact: true }).click(); await saved(page);
  expect(server.document.segments![0].text).toBe("HelloHello សួស្តី ");
  expect(server.document.segments![1]).toEqual(cues[1]);
  expect(server.document.segments![3]).toEqual(cues[3]);
});

test("Khmer replacement preserves clusters and canonical Latin matches preserve surrounding text", async ({ page }) => {
  const server = await setup(page); await search(page, "ស"); await expect(marks(page)).toHaveCount(0);
  const query = page.getByRole("searchbox", { name: "Find in transcript", exact: true });
  await query.fill("សួស្តី"); await expect(marks(page)).toHaveCount(3);
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("ជំរាបសួរ");
  await page.getByRole("button", { name: "Replace all", exact: true }).click(); await saved(page);
  expect(server.document.segments![0].text).toBe("Hello ជំរាបសួរ Hello");
  await query.fill("café"); await expect(marks(page)).toHaveCount(2);
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("$&");
  await page.getByRole("button", { name: "Replace all", exact: true }).click(); await saved(page);
  expect(server.document.segments![1].text).toBe("HELLO $& $& ជំរាបសួរ");
  expect(server.document.segments![2]).toEqual(cues[2]);
});

test("plain legacy text supports replacements, TXT export, and undo without inventing timestamps", async ({ page }) => {
  const server = await setup(page, false); const original = server.document.transcribed_text;
  await search(page, "Hello"); await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Replace all", exact: true }).click(); await saved(page);
  expect(server.document.segments).toBeNull(); expect(await download(page, "TXT")).not.toMatch(/hello/i);
  await expect(page.getByRole("button", { name: "Download SRT", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved(page);
  expect(server.document.transcribed_text).toBe(original);
});

test("overbroad search and oversized replacement block bulk edits without partial changes", async ({ page }) => {
  const server = await setup(page, true, [{start: 0, end: 5, text: "x".repeat(6000)}, {start: 5, end: 10, text: "unchanged"}]);
  await search(page, "x"); await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("xx");
  await expect(page.getByRole("alert").filter({hasText: "Replacement would exceed"})).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace all", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replace one", exact: true })).toBeEnabled();
  expect(server.patches).toHaveLength(0);
  await page.getByRole("button", { name: "Close find and replace", exact: true }).click();
  await page.getByRole("radio", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Segment 2 text", exact: true }).fill("x".repeat(6000)); await saved(page);
  const before = server.patches.length;
  await search(page, "x"); await expect(page.getByRole("status").filter({hasText:"More than 10,000 matches"})).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace all", exact: true })).toBeDisabled();
  expect(server.patches).toHaveLength(before);
});

test("bulk undo and a newer replacement serialize correctly during an in-flight save", async ({ page }) => {
  const server = await setup(page); await search(page, "Hello");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.beforePatch = async () => { if (server.patches.length === 1) await gate; };
  const sent = page.waitForRequest(r => r.method() === "PATCH");
  const replacement = page.getByRole("textbox", { name: "Replace with", exact: true });
  await replacement.fill("World"); await page.getByRole("button", { name: "Replace all", exact: true }).click(); await sent;
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await replacement.fill("Final"); await page.getByRole("button", { name: "Replace all", exact: true }).click();
  release(); await saved(page);
  expect(server.document.segments).toEqual(cues.map(cue => ({...cue, text: cue.text.replace(/hello/gi, "Final")})));
  expect(server.patches.map(p => p.revision)).toEqual([1, 2]);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved(page);
  expect(server.document.segments).toEqual(cues);
});

test("failed bulk saves recover every replacement and timestamp when reopening, then retry", async ({ page }) => {
  const server = await setup(page); server.fail = true; await search(page, "Hello");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("World");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  const srt = await download(page, "SRT");
  await page.getByRole("link", { name: "← Back to history", exact: true }).click();
  await page.getByRole("link", { name: "Edit transcript", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  expect(await download(page, "SRT")).toBe(srt);
  server.fail = false; await page.getByRole("button", { name: "Retry save", exact: true }).click(); await saved(page);
  expect(server.document.segments).toEqual(cues.map(cue => ({...cue, text: cue.text.replace(/hello/gi, "World")})));
});

test("Khmer search controls retain values through language changes and fit phone, tablet and desktop", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("bondeth.theme", "dark"));
  const server = await setup(page);
  await page.getByRole("radio", { name: "Words", exact: true }).click(); await search(page, "សួស្តី");
  await expect(page.getByRole("radio", { name: "Text", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("ជំរាបសួរ");
  await page.getByRole("button", { name: /Switch to Khmer/ }).click();
  await expect(page.getByRole("searchbox", { name: "ស្វែងរកក្នុងអត្ថបទ", exact: true })).toHaveValue("សួស្តី");
  await expect(page.getByRole("textbox", { name: "ជំនួសដោយ", exact: true })).toHaveValue("ជំរាបសួរ");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    await expect.poll(() => page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    if (width !== 768) await page.screenshot({path: info.outputPath(`find-replace-km-dark-${width}.png`), fullPage: true});
  }
  await page.getByRole("button", { name: "ជំនួសទាំងអស់", exact: true }).click();
  await expect(page.getByRole("status").filter({hasText: "បានរក្សាទុក"})).toBeVisible();
  expect(server.document.segments![0].text).toBe("Hello ជំរាបសួរ Hello");
});
