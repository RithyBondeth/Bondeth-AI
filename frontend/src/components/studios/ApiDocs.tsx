"use client";

import { ArrowRight, BookOpenText, Code2, Copy, KeyRound, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, Input, cx, useToast } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { API_BASE, API_ENDPOINTS, EXAMPLE_TARGETS, endpointExamples, type ApiEndpoint, type ExampleTarget } from "@/lib/api-reference";
import { useT } from "@/lib/useLocale";
import { ApiIntegrationGuide, ApiWorkflowGuide } from "@/components/studios/ApiIntegrationGuide";

const SECTIONS = [{ id: "quick-start", title: "Quick start" }, { id: "authentication", title: "Authentication" },
  { id: "frameworks", title: "Framework integrations" }, { id: "endpoints", title: "Endpoints" },
  { id: "audio-and-jobs", title: "Audio and jobs" }, { id: "errors", title: "Errors and limits" }];

export function ApiDocs() {
  const t = useT();
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const endpoints = API_ENDPOINTS.filter((item) => `${item.title} ${t(item.title)} ${item.method} ${item.path} ${item.description}`.toLowerCase().includes(search));

  return (
    <div className="min-w-0 space-y-8">
      <section className="paper-panel bg-accent-soft/40 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-xl">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-accent"><Code2 aria-hidden className="size-4" />{t("Developer guide")}</p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("Build with Khmer voice.")}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t("Bring transcription, speech generation, and voice cloning into your app. Start with an API key and a single request.")}</p>
          </div>
          <Link href="/api-keys" className="ink-button inline-flex h-10 items-center gap-2 whitespace-nowrap bg-accent px-4 text-sm font-medium text-accent-ink"><KeyRound aria-hidden className="size-4" />{t("API keys")}<ArrowRight aria-hidden className="size-4" /></Link>
        </div>
        <div className="mt-6 border-t border-line pt-4 text-xs text-ink-soft">
          <span className="mr-3 font-medium">{t("Base URL")}</span><code className="break-all font-mono text-ink">{API_BASE}</code>
        </div>
      </section>

      <div className="grid min-w-0 gap-8 xl:grid-cols-[160px_minmax(0,1fr)]">
        <aside className="self-start xl:sticky xl:top-24">
          <nav aria-label={t("API documentation navigation")} className="flex flex-wrap gap-1 xl:flex-col">
            {SECTIONS.map((item) => <a key={item.id} href={`#${item.id}`} className="rounded-lg px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface-2 hover:text-ink">{t(item.title)}</a>)}
          </nav>
          <p className="mt-5 hidden px-3 text-[11px] leading-relaxed text-ink-soft xl:block">{t("Examples for cURL, Node.js, Python, Next.js, Express, and Laravel.")}</p>
        </aside>
        <div className="min-w-0 space-y-10">
          <section id="quick-start" className="scroll-mt-24 space-y-4" aria-labelledby="quick-start-title">
            <h2 id="quick-start-title" className="text-xl font-bold tracking-tight">{t("Quick start")}</h2>
            <ol className="space-y-3 text-sm leading-relaxed text-ink-soft">
              <li><span className="font-medium text-ink">{t("Create a key.")}</span>{" "}{t("Sign in, open API keys, and create a key for your project. The full key is shown once.")}</li>
              <li><span className="font-medium text-ink">{t("Set your environment.")}</span>{" "}{t("Store the key in BONDETH_API_KEY on your server. Keep it out of browser code and source control.")}</li>
              <li><span className="font-medium text-ink">{t("Make a request.")}</span>{" "}{t("Choose an endpoint below and copy its example. Replace example filenames with your own files.")}</li>
            </ol>
          </section>

          <section id="authentication" className="scroll-mt-24 space-y-4" aria-labelledby="authentication-title">
            <h2 id="authentication-title" className="flex items-center gap-2 text-xl font-bold tracking-tight"><ShieldCheck aria-hidden className="size-5 text-accent" />{t("Authentication")}</h2>
            <p className="text-sm leading-relaxed text-ink-soft">{t("Send your key in X-API-Key, or use Authorization: Bearer <key>. Requests share your account allowance.")}</p>
            <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed"><code>{"X-API-Key: <your_api_key>\n\nAuthorization: Bearer <your_api_key>"}</code></pre>
            <p className="text-xs leading-relaxed text-ink-soft">{t("Transcription and standard speech also accept anonymous requests with IP-based limits. Voice cloning requires a verified account. Creating or revoking API keys requires a signed-in session, not an API key.")}</p>
          </section>

          <ApiIntegrationGuide />

          <section id="endpoints" className="scroll-mt-24 space-y-5" aria-labelledby="endpoints-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="endpoints-title" className="text-xl font-bold tracking-tight">{t("Endpoints")}</h2>
              <div className="relative w-full sm:w-60">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
                <Input aria-label={t("Search endpoints")} placeholder={t("Search endpoints")} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="space-y-6">
              {endpoints.map((endpoint) => <Endpoint key={endpoint.id} endpoint={endpoint} />)}
              {endpoints.length === 0 && <div role="status" className="rounded-2xl border border-dashed border-line p-8 text-center">
                <p className="text-sm font-medium">{t("No matching endpoints")}</p>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => setQuery("")}>{t("Clear search")}</Button>
              </div>}
            </div>
          </section>

          <ApiWorkflowGuide />

          <section id="errors" className="scroll-mt-24 space-y-4" aria-labelledby="errors-title">
            <h2 id="errors-title" className="text-xl font-bold tracking-tight">{t("Errors and limits")}</h2>
            <p className="text-sm leading-relaxed text-ink-soft">{t("Errors return a JSON detail field. Validation errors may return a list of field issues. Check the HTTP status before reading an audio response.")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["401 / 403", "Missing credentials, an invalid key, or insufficient access."],
                ["404 / 409", "The resource is unavailable, or a job is not ready."],
                ["413 / 422", "The upload or text is too large, or a field is invalid."],
                ["429 / 503", "An allowance is exhausted or a service is busy. Respect Retry-After when provided."],
              ].map(([status, detail]) => <div key={status} className="rounded-xl border border-line bg-surface p-4"><code className="text-xs font-bold text-accent">{status}</code><p className="mt-2 text-xs leading-relaxed text-ink-soft">{t(detail)}</p></div>)}
            </div>
            <p className="text-xs leading-relaxed text-ink-soft">{t("Read GET /usage for configured limits and resets_at. Retrying a generation request may consume more allowance; check job status before submitting it again.")}</p>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5 text-xs text-ink-soft">
            <BookOpenText aria-hidden className="size-4" /><span>{t("Need the complete schema?")}</span>
            <a href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{t("OpenAPI specification")}</a>
            <Link href="/voice-consent" className="ml-auto font-medium hover:text-ink">{t("Voice consent policy")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Endpoint({ endpoint }: { endpoint: ApiEndpoint }) {
  const t = useT();
  return (
    <article id={endpoint.id} className="paper-panel min-w-0 scroll-mt-24 overflow-hidden bg-surface">
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-accent-soft px-2 py-1 font-mono text-[11px] font-bold text-accent">{endpoint.method}</span>
          <code className="break-all text-sm font-medium">{endpoint.path}</code>
          <span className="ml-auto text-[11px] text-ink-soft">{t(endpoint.authenticated ? "Authentication required" : "Authentication optional")}</span>
        </div>
        <h3 className="text-lg font-bold">{t(endpoint.title)}</h3>
        <p className="text-sm leading-relaxed text-ink-soft">{t(endpoint.description)}</p>
        {endpoint.parameters.length > 0 && <dl className="space-y-4 border-t border-line pt-4">
          {endpoint.parameters.map((parameter) => <div key={parameter.name}>
            <dt className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><code className="break-all text-xs font-medium">{parameter.name}</code><span className="text-[11px] text-ink-soft">{parameter.type}</span></dt>
            <dd className="mt-1 text-xs leading-relaxed text-ink-soft">{t(parameter.detail)}</dd>
          </div>)}
        </dl>}
      </div>
      <CodeExample endpoint={endpoint} />
    </article>
  );
}

function CodeExample({ endpoint }: { endpoint: ApiEndpoint }) {
  const t = useT();
  const toast = useToast();
  const [language, setLanguage] = useState<ExampleTarget>("curl");
  const examples = endpointExamples(endpoint);
  async function copy() {
    try { await navigator.clipboard.writeText(examples[language]); toast("Copied to clipboard", "success"); }
    catch { toast("Couldn't copy. Select the example and copy it manually.", "error"); }
  }
  return (
    <div className="min-w-0 border-t border-line bg-surface-2/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div role="group" aria-label={`${t(endpoint.title)} ${t("Code example")}`} className="flex flex-wrap gap-1">
          {EXAMPLE_TARGETS.map(([value, label]) => <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)} className={cx("rounded-lg px-2 py-1.5 text-[11px] font-medium", language === value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink")}>{t(label)}</button>)}
        </div>
        <button type="button" onClick={copy} aria-label={`${t("Copy")} ${t(endpoint.title)} ${language}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-ink-soft hover:bg-surface hover:text-ink"><Copy aria-hidden className="size-3.5" />{t("Copy")}</button>
      </div>
      <pre className="scroll-thin max-h-96 overflow-auto p-4 text-xs leading-7 sm:p-5" tabIndex={0} aria-label={`${t(endpoint.title)} ${t("Code example")}`}><code>{examples[language]}</code></pre>
    </div>
  );
}
