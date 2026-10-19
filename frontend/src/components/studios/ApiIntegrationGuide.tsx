"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { cx, useToast } from "@/components/ui";
import { API_BASE } from "@/lib/api-reference";
import { useT } from "@/lib/useLocale";

const FRAMEWORKS = [
  { id: "python", title: "Python", install: "python -m pip install requests",
    setup: "export BONDETH_API_KEY='your_api_key'\npython example.py",
    location: "example.py", docs: "https://requests.readthedocs.io/en/latest/user/quickstart/",
    detail: "Install Requests and export your key in the shell that runs the script. The examples use context managers to close uploaded files, explicit network timeouts, and raise_for_status() before reading JSON or writing WAV bytes." },
  { id: "nextjs", title: "Next.js", install: "npm install server-only",
    setup: "# .env.local (never use NEXT_PUBLIC_ for this key)\nBONDETH_API_KEY=your_api_key",
    location: "lib/bondeth.ts", docs: "https://nextjs.org/docs/app/getting-started/server-and-client-components",
    detail: "Use the App Router with the Node.js runtime. Put the example in a server-only module and call it from an authenticated Route Handler or backend task. Return WAV bytes with Content-Type: audio/wav, or return job metadata as JSON. Never import this module into a Client Component." },
  { id: "express", title: "Express", install: "npm install express",
    setup: "# Set in your server environment\nBONDETH_API_KEY=your_api_key\n# Requires Node.js 20+; the example is an ES module (.mjs).",
    location: "bondeth-router.mjs", docs: "https://expressjs.com/en/guide/routing.html",
    detail: "The router factory requires your existing authentication middleware: mount bondethRouter(authenticate) in your app. Each example uses the endpoint's sample data. Validate user text and uploads before replacing those values. Upstream error statuses and Retry-After are passed to the caller; unexpected failures go to your error middleware." },
  { id: "laravel", title: "Laravel", install: "# Laravel 12: use the built-in Http and Storage facades.",
    setup: "// config/services.php: add this entry to the returned array.\n'bondeth' => [\n    'key' => env('BONDETH_API_KEY'),\n],\n\n// .env\nBONDETH_API_KEY=your_api_key\n\n// After changing configuration in production:\n// php artisan config:cache",
    location: "app/Services/BondethClient.php", docs: "https://laravel.com/docs/12.x/http-client",
    detail: "Read credentials through config('services.bondeth.key') so cached configuration works. Call the service from an authenticated controller or queued job. Upload examples read trusted files from storage/app/private; WAV output is written to the local storage disk. Handle RequestException in your application and do not automatically retry generation POSTs." },
] as const;

export function ApiIntegrationGuide() {
  const t = useT();
  const [selected, setSelected] = useState<(typeof FRAMEWORKS)[number]["id"]>("python");
  const active = FRAMEWORKS.find((framework) => framework.id === selected)!;
  return (
    <section id="frameworks" className="scroll-mt-24 space-y-4" aria-labelledby="frameworks-title">
      <h2 id="frameworks-title" className="text-xl font-bold tracking-tight">{t("Framework integrations")}</h2>
      <p className="text-sm leading-relaxed text-ink-soft">{t("Choose your stack, configure it once, then select the same framework in any endpoint example below. These examples run on your server; your frontend calls your authenticated backend.")}</p>
      <div role="group" aria-label={t("Integration framework")} className="flex flex-wrap gap-2">
        {FRAMEWORKS.map((framework) => <button key={framework.id} type="button" aria-pressed={selected === framework.id} onClick={() => setSelected(framework.id)} className={cx("rounded-xl border px-3 py-2 text-xs font-medium", selected === framework.id ? "border-line bg-accent-soft text-ink" : "border-transparent text-ink-soft hover:bg-surface-2")}>{framework.title}</button>)}
      </div>
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <h3 className="font-bold">{active.title}</h3>
        <p className="text-sm leading-relaxed text-ink-soft">{t(active.detail)}</p>
        <GuideCode title={t("Install")} code={active.install} />
        <GuideCode title={t("Configuration")} code={active.setup} />
        <p className="text-xs text-ink-soft">{t("Example file")}: <code className="break-all text-ink">{active.location}</code></p>
        <a href={active.docs} target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-accent hover:underline">{active.title} {t("Official documentation")} ↗</a>
      </div>
    </section>
  );
}

const POLLING_EXAMPLE = `import os
import time
from urllib.parse import urlsplit
import requests

API_BASE = ${JSON.stringify(API_BASE)}

def wait_for_job(created_job, timeout_seconds=600):
    status_url = created_job["status_url"]
    expected = urlsplit(API_BASE)
    actual = urlsplit(status_url)
    if (actual.scheme, actual.netloc) != (expected.scheme, expected.netloc):
        raise ValueError("Refusing to send credentials to another API host")
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        response = requests.get(
            status_url,
            headers={"X-API-Key": os.environ["BONDETH_API_KEY"]},
            timeout=(10, 30),
            allow_redirects=False,
        )
        response.raise_for_status()
        if response.is_redirect:
            raise RuntimeError("Unexpected API redirect")
        job = response.json()
        if job["status"] == "done":
            return job
        if job["status"] == "failed":
            raise RuntimeError(job.get("error") or "Job failed")
        time.sleep(2)
    raise TimeoutError("Still processing; poll the same job later")

# Pass the JSON returned by POST /stt/jobs or POST /clone.
# A completed transcription has result; a completed clone has audio_url.
# Download audio_url with the same authentication, after checking its host.
`;

export function ApiWorkflowGuide() {
  const t = useT();
  return (
    <section id="audio-and-jobs" className="scroll-mt-24 space-y-5" aria-labelledby="audio-jobs-title">
      <h2 id="audio-jobs-title" className="text-xl font-bold tracking-tight">{t("Audio, uploads, and queued jobs")}</h2>
      <div className="space-y-4 text-sm leading-relaxed text-ink-soft">
        <p>{t("Use JSON for /tts and /tts/preview. Send actual file bytes as multipart/form-data for transcription and reference-audio cloning, not a local path string or base64 JSON. Let your HTTP client set the multipart boundary.")}</p>
        <p>{t("The default upload limit is 25 MB for /stt and 200 MB for /stt/jobs; an installation can change these settings. Use jobs for longer recordings. Cloning references must be 3–30 seconds. Send either reference_audio with consent=true or a saved voice_id, never both.")}</p>
        <p>{t("A successful /tts response is WAV bytes, not JSON. Save it as a binary file, or serve it from your backend with Content-Type: audio/wav. In a browser, fetch your own authenticated audio route, convert the response to a Blob, and use a temporary object URL for an audio player. Revoke that URL when finished.")}</p>
        <p>{t("HTTP 202 means accepted, not finished. Save job_id and poll status_url while the status is queued or running. Stop at done or failed. A completed transcription contains result; a completed clone provides audio_url. Keep authentication on private status and audio requests.")}</p>
      </div>
      <GuideCode title={t("Wait for a queued job · Python")} code={POLLING_EXAMPLE} />
      <p className="text-xs leading-relaxed text-ink-soft">{t("If the polling timeout expires, keep the job ID and resume polling later. Do not create a duplicate job. For transcription streaming, events_url emits info, segment, done, and error events; use an SSE client that supports authentication headers.")}</p>
      <div className="rounded-xl border border-line bg-accent-soft/30 p-4">
        <h3 className="text-sm font-bold">{t("Before going live")}</h3>
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">{t("Authenticate your own users, validate input sizes, and rate-limit your proxy routes. Set network timeouts and check status codes before decoding responses. Respect Retry-After on 429/503. Check existing jobs before retrying generation requests, and avoid logging API keys or private recordings.")}</p>
      </div>
    </section>
  );
}

function GuideCode({ title, code }: { title: string; code: string }) {
  const t = useT();
  const toast = useToast();
  async function copy() {
    try { await navigator.clipboard.writeText(code); toast("Copied to clipboard", "success"); }
    catch { toast("Couldn't copy. Select the example and copy it manually.", "error"); }
  }
  return <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface-2/50">
    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
      <p className="text-xs font-medium">{title}</p>
      <button type="button" onClick={copy} aria-label={`${t("Copy")} ${title}`} className="rounded-lg p-2 text-ink-soft hover:bg-surface hover:text-ink"><Copy aria-hidden className="size-3.5" /></button>
    </div>
    <pre tabIndex={0} aria-label={title} className="scroll-thin max-h-96 overflow-auto p-4 text-xs leading-7"><code>{code}</code></pre>
  </div>;
}
