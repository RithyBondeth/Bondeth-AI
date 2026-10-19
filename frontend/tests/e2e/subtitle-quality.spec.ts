import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { visibleUnits, captionText, subtitleIssues, suggestedTiming } from "../../src/lib/subtitleQuality";
import type { TranscriptionDetail, TranscriptSegment } from "../../src/lib/types";

function wav() {
  const data = Buffer.alloc(44 + 32000 * 10);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40); return data;
}
const id = "00000000-0000-0000-0000-000000000020";
const user = { id: "quality-user", email: "find@example.com", full_name: "Finder", email_verified: true, created_at: "2026-10-18T00:00:00Z" };
const cues: TranscriptSegment[] = [
  {start: 0, end: 0.5, text: "Short"},
  {start: 2, end: 4, text: "A very long subtitle needs a thoughtful split before the listener can read everything."},
  {start: 3, end: 5, text: "សួស្តី café 👨‍👩‍👧‍👦"},
  {start: 6, end: 8, text: "Last caption"},
];
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PATCH,POST,OPTIONS" };
async function setup(page: Page, timed = true, segments = cues, audio = false) {
  const server = { document: { id, language_code: "km", transcribed_text: segments.map(s => s.text).join(" "), segments: timed ? segments : null,
    segmented_text: "Model word separated formatting", revision: 1, updated_at: null, audio_duration_seconds: 10,
    created_at: user.created_at, source_audio_status: audio ? "available" : "not_saved" } as TranscriptionDetail,
    beforeAudio: null as (() => Promise<void>) | null, audioRequests: 0, patches: [] as Array<{revision: number; segments?: TranscriptSegment[]; text?: string}>, fail: false,
    beforePatch: null as (() => Promise<void>) | null };
  await page.addInitScript((user) => localStorage.setItem("bondeth.session", JSON.stringify({ access: "quality-token", refresh: "refresh", user })), user);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.endsWith("/source-audio")) {
      server.audioRequests++;
      if (server.beforeAudio) await server.beforeAudio();
      return route.fulfill({body: wav(), contentType: "audio/wav", headers});
    }
    if (path === `/api/v1/transcriptions/${id}`) {
      expect(request.headers().authorization).toBe("Bearer quality-token");
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

async function openQuality(page: Page) {
  await page.getByRole("button", { name: "Quality and preview", exact: true }).click();
}
const issue = (page: Page, text: string) => page.getByRole("button", { name: text, exact: true });
async function download(page: Page, format: "SRT" | "VTT") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${format}`, exact: true }).click();
  return readFile((await (await pending).path())!, "utf8");
}

test("visible units respect Khmer marks, canonical equivalence, emoji and whitespace", () => {
  expect(visibleUnits("សួ")).toBe(1);
  expect(visibleUnits("ក្តី")).toBe(1);
  expect(visibleUnits("café")).toBe(visibleUnits("cafe\u0301"));
  expect(visibleUnits("👨‍👩‍👧‍👦 🇰🇭")).toBe(2);
  expect(visibleUnits(" \n\t\u200b\u0301")).toBe(0);
  expect(visibleUnits("Hello world!")).toBe(11);
  expect(captionText(" a\r\n\r\n b ")).toBe("a\nb");
});

test("checks flag thresholds, explicit lines, empty exports and non-adjacent nested overlaps", () => {
  expect(subtitleIssues([{start:0,end:1,text:"សួ".repeat(17)}])).toEqual([]);
  const found = subtitleIssues([
    {start:0,end:10,text:"a".repeat(43)}, {start:1,end:2,text:"short"},
    {start:3,end:3.5,text:"a\nb\nc"}, {start:10,end:11,text:"  "},
  ]);
  expect(found.filter(i => i.kind === "overlap").map(i => i.segment)).toEqual([0,1,2]);
  expect(found).toContainEqual({segment:0,kind:"long",value:10});
  expect(found.some(i => i.kind === "length" && i.segment === 2)).toBe(true);
  expect(found.some(i => i.kind === "short" && i.segment === 2)).toBe(true);
  expect(found).toContainEqual({segment:3,kind:"empty",value:0});
});

test("timing suggestions fit recording and neighbor bounds without changing inputs", () => {
  const original = structuredClone(cues);
  expect(suggestedTiming(cues,{segment:0,kind:"short",value:0.5},10)).toBe(1);
  expect(suggestedTiming(cues,{segment:1,kind:"fast",value:30},10)).toBeNull();
  expect(suggestedTiming(cues,{segment:1,kind:"overlap",value:0},10)).toBe(3);
  expect(suggestedTiming(cues,{segment:2,kind:"overlap",value:0},10)).toBeNull();
  expect(suggestedTiming([{start:0,end:0.5,text:"Short"}],{segment:0,kind:"short",value:0},0.7)).toBeNull();
  expect(suggestedTiming([{start:0,end:0.5,text:"a".repeat(120)}],{segment:0,kind:"fast",value:0},null)).toBeNull();
  expect(cues).toEqual(original);
});

test("issues navigate to editable cues and silent preview without edits or audio requests", async ({page}) => {
  const server = await setup(page, true, cues, true); await openQuality(page);
  await issue(page,"Segment 3: Captions overlap").focus();
  await issue(page,"Segment 3: Captions overlap").press("Enter");
  await expect(page.getByRole("textbox",{name:"Segment 3 text",exact:true})).toBeFocused();
  await expect(page.locator("[data-caption-preview]")).toContainText(cues[2].text);
  await expect(page.locator("[data-caption-preview]")).toContainText(cues[1].text);
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("5.5");
  await expect(page.locator("[data-caption-preview]")).toHaveText("No caption at this time");
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("6");
  await expect(page.locator("[data-caption-preview]")).toHaveText("Last caption");
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("8");
  await expect(page.locator("[data-caption-preview]")).toHaveText("No caption at this time");
  expect(server.patches).toHaveLength(0); expect(server.audioRequests).toBe(0);
  expect(await download(page,"SRT")).toContain("00:00:00,500"); // Warnings never block exports.
});

test("reviewed timing fix autosaves once, exports immediately, and supports one-step undo/redo", async ({page}) => {
  const server = await setup(page); await openQuality(page);
  await page.getByRole("button",{name:"Review timing suggestion for segment 1",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("00:00:00.500 → 00:00:01.000");
  await page.getByRole("button",{name:"Cancel",exact:true}).click(); expect(server.patches).toHaveLength(0);
  await page.getByRole("button",{name:"Review timing suggestion for segment 1",exact:true}).click();
  await page.getByRole("button",{name:"Apply timing",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Segment 1 text",exact:true})).toBeFocused();
  expect(await download(page,"SRT")).toContain("00:00:00,000 --> 00:00:01,000\nShort");
  expect(await download(page,"VTT")).toContain("00:00:00.000 --> 00:00:01.000\nShort");
  await saved(page); expect(server.patches).toHaveLength(1);
  expect(server.document.segments).toEqual(cues.map((cue,i) => i === 0 ? {...cue,end:1} : cue));
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await saved(page);
  expect(server.document.segments).toEqual(cues);
  await page.getByRole("button",{name:"Redo",exact:true}).click(); await saved(page);
  await page.reload(); await saved(page); await openQuality(page);
  await expect(issue(page,"Segment 1: Display time is short")).toHaveCount(0);
});

test("split suggestions preserve Khmer graphemes and outer timestamps in exports and undo", async ({page}) => {
  const segments = [{start:0,end:6,text:"ក្តី".repeat(60)}];
  const server = await setup(page,true,segments); await openQuality(page);
  await page.getByRole("button",{name:"Review split for segment 1",exact:true}).click();
  const first = page.getByRole("textbox",{name:"First part",exact:true});
  const second = page.getByRole("textbox",{name:"Second part",exact:true});
  expect((await first.inputValue())+(await second.inputValue())).toBe(segments[0].text);
  expect(visibleUnits(await first.inputValue())+visibleUnits(await second.inputValue())).toBe(60);
  await page.getByRole("button",{name:"Apply split",exact:true}).click(); await saved(page);
  expect(server.document.segments).toHaveLength(2);
  expect(server.document.segments![0].start).toBe(0); expect(server.document.segments![1].end).toBe(6);
  expect(await download(page,"VTT")).toContain("00:00:03.000 --> 00:00:06.000");
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await saved(page);
  expect(server.document.segments).toEqual(segments);
});

test("live preview follows private playback, silence, edits and undo; scrubbing pauses audio", async ({page}) => {
  const server = await setup(page,true,cues,true); await openQuality(page);
  await page.getByRole("button",{name:"Play segment 4",exact:true}).click();
  await expect(page.locator("[data-caption-preview]")).toHaveText("Last caption");
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("3.2");
  await expect(page.getByRole("button",{name:"Play source audio",exact:true})).toBeVisible();
  const audio = page.locator("audio"); expect(await audio.evaluate((el:HTMLAudioElement) => el.paused)).toBe(true);
  await expect(page.locator("[data-caption-preview]")).toContainText(cues[2].text);
  await issue(page,"Segment 3: Captions overlap").click();
  await page.getByRole("textbox",{name:"Segment 3 text",exact:true}).fill("Updated preview");
  await expect(page.locator("[data-caption-preview]")).toContainText("Updated preview");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator("[data-caption-preview]")).toContainText(cues[2].text);
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("5.5");
  await expect(page.locator("[data-caption-preview]")).toHaveText("No caption at this time");
  expect(server.audioRequests).toBe(1);
});

test("failed saves keep quality fixes and exports available for retry", async ({page}) => {
  const server = await setup(page); server.fail = true; await openQuality(page);
  await page.getByRole("button",{name:"Review timing suggestion for segment 1",exact:true}).click();
  await page.getByRole("button",{name:"Apply timing",exact:true}).click();
  await expect(page.getByRole("button",{name:"Retry save",exact:true})).toBeVisible();
  expect(await download(page,"SRT")).toContain("00:00:01,000\nShort");
  server.fail = false; await page.getByRole("button",{name:"Retry save",exact:true}).click(); await saved(page);
  expect(server.document.segments![0].end).toBe(1);
});

test("plain transcripts stay editable without invented quality timings and clean captions show no issues", async ({page}) => {
  await setup(page,false); await expect(page.getByRole("button",{name:"Quality and preview",exact:true})).toHaveCount(0);
  await setup(page,true,[{start:1,end:3,text:"សួស្តី"}]); await openQuality(page);
  await expect(page.getByText("No subtitle issues found",{exact:true})).toBeVisible();
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("1");
  await expect(page.locator("[data-caption-preview]")).toHaveText("សួស្តី");
});

test("paginated issues and Khmer interface fit phone, tablet and desktop", async ({page},info) => {
  await page.addInitScript(() => localStorage.setItem("bondeth.theme","dark"));
  await setup(page,true,Array.from({length:70},(_,i) => ({start:i/10,end:i/10+0.05,text:"សួស្តី"})));
  await openQuality(page);
  await expect(page.getByRole("list",{name:"Subtitle issues",exact:true}).locator("li")).toHaveCount(50);
  await page.getByRole("button",{name:"Next issues",exact:true}).click();
  await expect(page.getByText("Page 2 of 3",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:/Switch to Khmer/}).click();
  await expect(page.getByRole("heading",{name:"មើលចំណងជើងរងជាមុនពេលចាក់សំឡេង",exact:true})).toBeVisible();
  await expect(page.getByText("ទំព័រទី 2 នៃ 3",{exact:true})).toBeVisible();
  for (const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(() => page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1440) await page.screenshot({path:info.outputPath(`quality-km-dark-${width}.png`),fullPage:true});
  }
});


test("undo during a saving quality fix serializes the restored timing at the next revision", async ({page}) => {
  const server = await setup(page); await openQuality(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  server.beforePatch = async () => {if (server.patches.length === 1) await gate;};
  await page.getByRole("button",{name:"Review timing suggestion for segment 1",exact:true}).click();
  const sent = page.waitForRequest(r => r.method() === "PATCH");
  await page.getByRole("button",{name:"Apply timing",exact:true}).click(); await sent;
  await page.getByRole("button",{name:"Undo",exact:true}).click(); release();
  await expect.poll(() => server.patches.length).toBe(2); await saved(page);
  expect(server.patches.map(p => p.revision)).toEqual([1,2]);
  expect(server.document.segments).toEqual(cues);
  expect(await download(page,"SRT")).toContain("00:00:00,500\nShort");
});


test("scrubbing while source audio loads cancels the pending playback request", async ({page}) => {
  const server = await setup(page,true,cues,true); await openQuality(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  server.beforeAudio = async () => gate;
  await page.getByRole("button",{name:"Play source audio",exact:true}).click();
  await expect.poll(() => server.audioRequests).toBe(1);
  await page.getByRole("slider",{name:"Preview position",exact:true}).fill("6");
  release();
  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((el:HTMLAudioElement) => el.readyState)).toBeGreaterThanOrEqual(1);
  expect(await audio.evaluate((el:HTMLAudioElement) => el.paused)).toBe(true);
  await expect(page.locator("[data-caption-preview]")).toHaveText("Last caption");
  await page.getByRole("button",{name:"Play source audio",exact:true}).click();
  await expect(page.getByRole("button",{name:"Pause source audio",exact:true})).toBeVisible();
  expect(await audio.evaluate((el:HTMLAudioElement) => el.currentTime)).toBeGreaterThanOrEqual(6);
  await page.getByRole("button",{name:"Pause source audio",exact:true}).click();
});


test("long caption preview remains scrollable from its first line and keeps markup literal", async ({page}) => {
  await setup(page,true,[{start:0,end:6,text:"<b>Literal caption</b>\n" + "Long caption line.\n".repeat(80)}]);
  await openQuality(page);
  const preview = page.locator("[data-caption-preview]");
  await expect(preview).toContainText("<b>Literal caption</b>");
  await expect(preview.locator("b")).toHaveCount(0);
  expect(await preview.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await preview.evaluate(el => el.querySelector("p")!.getBoundingClientRect().top >= el.getBoundingClientRect().top)).toBe(true);
  await preview.evaluate(el => {el.scrollTop = el.scrollHeight;});
  expect(await preview.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});
