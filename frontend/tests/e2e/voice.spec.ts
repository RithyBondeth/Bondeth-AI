import { test, expect } from "@playwright/test";

test("dictation releases microphone and audio context when worklet setup fails", async ({ page }) => {
  await page.route("**/api/v1/usage", (route) => route.fulfill({ json: { quotas: {} } }));
  await page.addInitScript(() => {
    const probe = { stopped: false, closed: false };
    Object.assign(window, { voiceProbe: probe });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => ({
      getTracks: () => [{ stop: () => { probe.stopped = true; } }],
    }) });
    // This test exercises setup failure, not the host audio device. A native
    // AudioContext can stall during headless/device initialization. The separate
    // streaming test below still runs the real context and real worklet.
    window.AudioContext = class {
      audioWorklet = { addModule: async () => { throw new Error("Worklet unavailable"); } };
      async close() { probe.closed = true; }
    } as unknown as typeof AudioContext;
  });
  await page.goto("/stt");
  await page.getByRole("button", { name: "Start dictation" }).click();
  await expect(page.getByText("Couldn't start the microphone.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    voiceProbe: { stopped: boolean; closed: boolean };
  }).voiceProbe)).toEqual({ stopped: true, closed: true });
});

test("real audio worklet streams synthetic PCM and finalizes on stop", async ({ page }) => {
  await page.route("**/api/v1/usage", (route) => route.fulfill({ json: { quotas: {} } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const target = ctx.createMediaStreamDestination();
      oscillator.connect(target);
      oscillator.start();
      await ctx.resume();
      const track = target.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); oscillator.stop(); void ctx.close(); };
      return target.stream;
    } });
  });
  let audioBytes = 0;
  await page.routeWebSocket("**/api/v1/stt/live", (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== "string") { audioBytes += message.length; return; }
      const msg = JSON.parse(message);
      if (msg.type === "start") socket.send(JSON.stringify({ type: "ready" }));
      if (msg.type === "stop") {
        socket.send(JSON.stringify({ type: "done", text: "Synthetic microphone worked.", segmented_text: "Synthetic microphone worked.",
          language: "en", duration: audioBytes / 32000, transcription_id: null }));
        socket.close();
      }
    });
  });
  await page.goto("/stt");
  await page.getByRole("button", { name: "Start dictation" }).click();
  await expect.poll(() => audioBytes, { timeout: 10000 }).toBeGreaterThan(3200);
  await page.getByRole("button", { name: "Stop dictation" }).click();
  await expect(page.getByText("Synthetic microphone worked.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Start dictation" })).toBeEnabled();
});
