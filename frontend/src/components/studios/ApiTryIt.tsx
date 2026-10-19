"use client";

import { Play, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { ApiRequestFields, PLAYGROUND_SELECT } from "@/components/studios/ApiRequestFields";
import { Button, Field, Input } from "@/components/ui";
import { API_URL, notifyUsageChanged, sessionStore } from "@/lib/api";
import { API_BASE, API_ENDPOINTS, type ApiEndpoint } from "@/lib/api-reference";
import { getLocale } from "@/lib/i18n";
import { useT } from "@/lib/useLocale";

type Authentication = "session" | "anonymous" | "key";
type Result = { status: number; elapsed: number; bytes: number; headers: string; body: string; audio?: Blob };
const RESPONSE_HEADERS = ["content-type", "content-length", "retry-after", "x-cache", "x-tts-engine", "x-tts-fallback", "x-audio-duration", "x-audio-id"];

export function ApiTryIt({ endpointId, onEndpointChange }: { endpointId: string; onEndpointChange: (id: string) => void }) {
  const t = useT();
  const [authentication, setAuthentication] = useState<Authentication>("session");
  const [apiKey, setApiKey] = useState("");
  const endpoint = API_ENDPOINTS.find((item) => item.id === endpointId)!;
  return <section id="try-it" aria-labelledby="try-it-title" className="scroll-mt-24 space-y-5">
    <h2 id="try-it-title" className="flex items-center gap-2 text-xl font-bold tracking-tight"><Play aria-hidden className="size-5 text-accent" />{t("Try it")}</h2>
    <p className="text-sm leading-relaxed text-ink-soft">{t("Send a real request to your configured API and inspect the response. Generation requests use your allowance. Nothing is sent automatically.")}</p>
    <div className="paper-panel min-w-0 space-y-5 bg-surface p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Endpoint")}>
          {(id) => <select id={id} value={endpointId} onChange={(event) => onEndpointChange(event.target.value)} className={PLAYGROUND_SELECT}>
            {API_ENDPOINTS.map((item) => <option key={item.id} value={item.id}>{item.method} {item.path} · {t(item.title)}</option>)}
          </select>}
        </Field>
        <Field label={t("Request authentication")}>
          {(id) => <select id={id} value={authentication} onChange={(event) => { setAuthentication(event.target.value as Authentication); setApiKey(""); }} className={PLAYGROUND_SELECT}>
            <option value="session">{t("Current session")}</option><option value="anonymous">{t("No authentication")}</option><option value="key">{t("API key")}</option>
          </select>}
        </Field>
      </div>
      {authentication === "key" && <Field label={t("API key")} hint={t("Kept only in memory for this page. Sent only to the API shown below; never saved to browser storage.")}>
        {(id) => <div className="flex items-center gap-2"><Input id={id} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="bdk_…" /><Button size="sm" variant="ghost" onClick={() => setApiKey("")}>{t("Clear")}</Button></div>}
      </Field>}
      {authentication === "session" && <p className="text-xs text-ink-soft">{t("Uses your signed-in session when available; otherwise sends an anonymous request.")}</p>}
      <code className="block break-all rounded-xl bg-surface-2 p-3 text-xs">{endpoint.method} {API_BASE}{endpoint.path}</code>
      <ApiRequest key={endpoint.id} endpoint={endpoint} authentication={authentication} apiKey={apiKey} />
    </div>
  </section>;
}

function ApiRequest({ endpoint, authentication, apiKey }: { endpoint: ApiEndpoint; authentication: Authentication; apiKey: string }) {
  const t = useT();
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [job, setJob] = useState<{ id: string; done: boolean } | null>(null);
  useEffect(() => () => { const active = controller.current; controller.current = null; active?.abort(); }, []);

  async function send(path: string, method: string, body?: BodyInit) {
    setError(null);
    setResult(null);
    if (authentication === "key" && !apiKey.trim()) { setError("Enter an API key or choose another authentication mode."); return; }
    const headers = new Headers({ "Accept-Language": getLocale() });
    if (authentication === "key") headers.set("X-API-Key", apiKey.trim());
    if (authentication === "session") {
      const session = sessionStore.get();
      if (session) headers.set("Authorization", `Bearer ${session.access}`);
    }
    if (typeof body === "string") headers.set("Content-Type", "application/json");
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    const started = performance.now();
    const timeout = setTimeout(() => active.abort("timeout"), 120_000);
    try {
      // Fixed API paths only. Do not follow response-supplied URLs or resend POSTs automatically.
      const response = await fetch(`${API_URL}${path}`, { method, headers, body, signal: active.signal, redirect: "error", credentials: "omit", cache: "no-store" });
      const blob = await response.blob();
      const isAudio = response.ok && (response.headers.get("content-type") ?? "").startsWith("audio/");
      let text = isAudio ? "" : await blob.text();
      if (controller.current !== active) return;
      if (!isAudio) {
        try {
          const json: unknown = JSON.parse(text);
          text = JSON.stringify(json, null, 2);
          if (response.ok && json && typeof json === "object" && "job_id" in json && typeof json.job_id === "string" && (endpoint.id === "transcription-jobs" || endpoint.id === "voice-cloning")) {
            setJob({ id: json.job_id, done: "status" in json && json.status === "done" });
          }
        } catch { /* Non-JSON responses remain visible as text. */ }
      }
      setResult({ status: response.status, elapsed: Math.round(performance.now() - started), bytes: blob.size,
        headers: RESPONSE_HEADERS.flatMap((name) => response.headers.has(name) ? [`${name}: ${response.headers.get(name)}`] : []).join("\n"),
        body: text, ...(isAudio ? { audio: blob } : {}) });
    } catch {
      if (controller.current === active) setError(active.signal.aborted
        ? active.signal.reason === "timeout" ? "Request timed out. Queued server work may still continue." : "Request cancelled. Server work may still continue."
        : "Could not reach the API. Check the backend connection and CORS configuration.");
    } finally {
      clearTimeout(timeout);
      if (method === "POST" && endpoint.id !== "speech-preview") notifyUsageChanged();
      if (controller.current === active) { controller.current = null; setBusy(false); }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const data = new FormData(event.currentTarget);
    let body: BodyInit | undefined;
    if (endpoint.json) {
      try {
        const json: unknown = JSON.parse(String(data.get("json")));
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error();
        body = JSON.stringify(json);
      } catch { setError("Enter a valid JSON object before sending."); return; }
    } else if (endpoint.form) {
      for (const [key, value] of Array.from(data.entries())) if (typeof value === "string" && value === "") data.delete(key);
      body = data;
    }
    setJob(null);
    void send(`/api/v1${endpoint.path}`, endpoint.method, body);
  }

  const jobPath = job ? `/api/v1/${endpoint.id === "voice-cloning" ? "clone" : "stt"}/jobs/${encodeURIComponent(job.id)}` : "";
  return <div className="grid min-w-0 gap-6 xl:grid-cols-2">
    <form onSubmit={submit} className="min-w-0 space-y-4">
      <fieldset disabled={busy} className="min-w-0"><ApiRequestFields endpoint={endpoint} /></fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} icon={<Play aria-hidden className="size-4" />}>{busy ? t("Sending request…") : t("Send request")}</Button>
        {busy && <Button type="button" variant="secondary" onClick={() => controller.current?.abort("cancelled")} icon={<Square aria-hidden className="size-3" />}>{t("Cancel")}</Button>}
      </div>
      <p className="text-[11px] leading-relaxed text-ink-soft">{t("Requests time out after two minutes. Cancelling stops this browser request, but may not stop work already running on the server.")}</p>
    </form>
    <div className="min-w-0 space-y-4" aria-label={t("API response")}>
      <h3 className="text-sm font-bold">{t("Response")}</h3>
      {error && <p role="alert" className="rounded-xl bg-rose-soft p-3 text-sm text-rose">{t(error)}</p>}
      {!result && !error && <p role="status" className="rounded-xl border border-dashed border-line p-5 text-xs leading-relaxed text-ink-soft">{busy ? t("Waiting for the API response…") : t("Send a request to see its status, headers, and response body here.")}</p>}
      {result && <>
        <p role="status" className="flex flex-wrap gap-x-3 gap-y-1 text-xs"><strong className={result.status < 400 ? "text-ink" : "text-rose"}>HTTP {result.status}</strong><span className="text-ink-soft">{result.elapsed} ms</span><span className="text-ink-soft">{result.bytes} {t("bytes")}</span></p>
        {result.audio ? <AudioPlayer blob={result.audio} filename="bondeth-api-response.wav" compact />
          : <pre aria-label={t("Response body")} tabIndex={0} className="scroll-thin max-h-96 overflow-auto rounded-xl bg-surface-2 p-4 text-xs leading-relaxed"><code>{result.body || t("Empty response body")}</code></pre>}
        <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-xs font-medium">{t("Response headers")}</summary><pre className="mt-3 overflow-auto text-[11px] leading-relaxed">{result.headers || t("No response headers available")}</pre></details>
      </>}
      {job && <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void send(jobPath, "GET")}>{t("Check job status")}</Button>
        {job.done && endpoint.id === "voice-cloning" && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void send(`${jobPath}/audio`, "GET")}>{t("Get job audio")}</Button>}
      </div>}
    </div>
  </div>;
}
