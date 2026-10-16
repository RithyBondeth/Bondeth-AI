import { test, expect, type Page } from "@playwright/test";

async function clonePage(page: Page) {
  const user = { id: "synthetic-quality-test", email: "test@example.com", email_verified: true, full_name: "Test" };
  await page.addInitScript((u) => {
    localStorage.setItem("bondeth.session", JSON.stringify({ access: "test-access", refresh: "test-refresh", user: u }));
  }, user);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/v1/auth/me" ? user : path === "/api/v1/voices" ? []
      : path === "/api/v1/clone" ? { job_id: "synthetic-job", status: "failed", error: "Test synthesis complete",
        reference_text_source: "provided", status_url: "/api/v1/clone/jobs/synthetic-job" }
      : { quotas: {}, signed_in: true };
    await route.fulfill({ json, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.goto("/clone");
  await expect(page.getByLabel("Reference transcript (optional)")).toBeVisible();
}

function syntheticWav() {
  const rate = 16000;
  const data = Buffer.alloc(44 + 4 * rate * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < 4 * rate; i++) data.writeInt16LE(Math.round(6000 * Math.sin(i * 220 * 2 * Math.PI / rate)), 44 + i * 2);
  return { name: "synthetic.wav", mimeType: "audio/wav", buffer: data };
}

test("clone sends corrected reference transcript and resets it for a replacement sample", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    // Motion's development-only notice is expected: these fixtures request reduced motion.
    if (message.type() === "warning" && message.text().startsWith("You have Reduced Motion enabled on your device.")) return;
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  await clonePage(page);
  await page.locator('input[type="file"]').setInputFiles(syntheticWav());
  const transcript = page.getByLabel("Reference transcript (optional)");
  await transcript.fill("សួស្តី ខ្ញុំចូលចិត្តភាសាខ្មែរ។");
  await page.getByRole("checkbox").check();
  const pending = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/v1/clone" && r.method() === "POST");
  await page.getByRole("button", { name: "Clone & speak" }).click();
  const req = await pending;
  const body = req.postDataBuffer()!.toString("utf8");
  expect(body).toContain('name="reference_text"');
  expect(body).toContain("សួស្តី ខ្ញុំចូលចិត្តភាសាខ្មែរ។");
  await expect(page.getByText("Test synthesis complete")).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 320 || width === 1440) {
      await page.screenshot({ path: info.outputPath(`clone-quality-${width}.png`), fullPage: true });
    }
  }
  await page.screenshot({ path: info.outputPath("clone-quality.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove audio" }).click();
  await expect(transcript).toHaveValue("");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("clone recording requests unprocessed audio and cleans up if the recorder fails", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { constraints: null as MediaStreamConstraints | null, options: null as MediaRecorderOptions | null,
      stopped: false, closed: false };
    Object.assign(window, { cloneRecordingProbe: probe });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async (constraints: MediaStreamConstraints) => {
      probe.constraints = constraints;
      const stream = new MediaStream();
      Object.defineProperty(stream, "getTracks", { value: () => [{ stop: () => { probe.stopped = true; } }] });
      return stream;
    } });
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      createMediaStreamSource() { return this.createGain() as unknown as MediaStreamAudioSourceNode; }
      async close() { probe.closed = true; await super.close(); }
    };
    window.MediaRecorder = class {
      constructor(_stream: MediaStream, options: MediaRecorderOptions) {
        probe.options = options;
        throw new Error("Recorder unavailable");
      }
    } as unknown as typeof MediaRecorder;
  });
  await clonePage(page);
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByText("Couldn't start recording. Try another browser or upload an audio file.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { cloneRecordingProbe: unknown }).cloneRecordingProbe)).toEqual({
    constraints: { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
    options: { audioBitsPerSecond: 192000 }, stopped: true, closed: true,
  });
});
