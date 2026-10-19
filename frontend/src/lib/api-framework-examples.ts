import type { ApiEndpoint } from "@/lib/api-reference";

function pythonLiteral(value: unknown): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(", ")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).map(([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item)}`).join(", ")}}`;
  return JSON.stringify(value);
}

function phpLiteral(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(phpLiteral).join(", ")}]`;
  if (value !== null && typeof value === "object") return `[${Object.entries(value as Record<string, unknown>).map(([key, item]) => `${JSON.stringify(key)} => ${phpLiteral(item)}`).join(", ")}]`;
  return JSON.stringify(value);
}

export function frameworkExamples(endpoint: ApiEndpoint, url: string) {
  const file = Object.entries(endpoint.form ?? {}).find(([, value]) => value.startsWith("@"));
  const fields = Object.fromEntries(Object.entries(endpoint.form ?? {}).filter(([, value]) => !value.startsWith("@")));
  const requestArgs = ["headers=headers", "timeout=(10, 120)"];
  if (endpoint.json) requestArgs.push(`json=${pythonLiteral(endpoint.json)}`);
  if (endpoint.form) requestArgs.push(`data=${pythonLiteral(fields)}`);
  if (file) requestArgs.push(`files={${JSON.stringify(file[0])}: (${JSON.stringify(file[1].slice(1))}, audio)}`);
  const python = [
    "import os", "from pathlib import Path", "import requests", "",
    'headers = {"X-API-Key": os.environ["BONDETH_API_KEY"]}',
    ...(file ? [`with open(${JSON.stringify(file[1].slice(1))}, "rb") as audio:`] : []),
    `${file ? "    " : ""}response = requests.${endpoint.method.toLowerCase()}(`,
    `${file ? "    " : ""}    ${JSON.stringify(url)},`,
    ...requestArgs.map((arg) => `${file ? "    " : ""}    ${arg},`),
    `${file ? "    " : ""})`, "response.raise_for_status()",
    endpoint.output === "wav" ? 'Path("speech.wav").write_bytes(response.content)' : "print(response.json())",
  ].join("\n");

  const setup: string[] = [];
  if (endpoint.form) {
    setup.push("const form = new FormData();");
    Object.entries(endpoint.form).forEach(([key, value]) => setup.push(value.startsWith("@")
      ? `form.set("${key}", new Blob([await readFile("${value.slice(1)}")]), "${value.slice(1)}");`
      : `form.set("${key}", ${JSON.stringify(value)});`));
  }
  const fetchLines = [
    `const response = await fetch(${JSON.stringify(url)}, {`, `  method: "${endpoint.method}",`,
    `  headers: { "X-API-Key": key${endpoint.json ? ', "Content-Type": "application/json"' : ""} },`,
    ...(endpoint.json ? [`  body: JSON.stringify(${JSON.stringify(endpoint.json)}),`] : endpoint.form ? ["  body: form,"] : []),
    '  cache: "no-store",', "  signal: AbortSignal.timeout(120_000),", "});",
  ];
  const nextjs = [
    '// lib/bondeth.ts (server only; use the Node.js runtime)', 'import "server-only";',
    ...(file ? ['import { readFile } from "node:fs/promises";'] : []), "",
    "export async function callBondeth() {", '  const key = process.env.BONDETH_API_KEY;',
    '  if (!key) throw new Error("Set BONDETH_API_KEY in .env.local");',
    ...[...setup, ...fetchLines, 'if (!response.ok) throw new Error(`Bondeth HTTP ${response.status}: ${await response.text()}`);',
      endpoint.output === "wav" ? "return new Uint8Array(await response.arrayBuffer());" : "return response.json();"].map((line) => `  ${line}`),
    "}", "", "// Call callBondeth() from an authenticated server route or backend task.",
    ...(endpoint.output === "wav" ? ['// In a Route Handler, return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });'] : ["// Queued endpoints return job metadata. Poll status_url before using the result."]),
  ].join("\n");

  const express = [
    '// bondeth-router.mjs (Express 5, Node.js 20+)', 'import { Router } from "express";',
    ...(file ? ['import { readFile } from "node:fs/promises";'] : []), "",
    "// Pass your existing authentication middleware when mounting this router.",
    "export function bondethRouter(authenticate) {", "  const router = Router();",
    `  router.${endpoint.method.toLowerCase()}("/bondeth", authenticate, async (_req, res, next) => {`, "    try {",
    '      const key = process.env.BONDETH_API_KEY;', '      if (!key) throw new Error("Set BONDETH_API_KEY on the server");',
    ...[...setup, ...fetchLines,
      "if (!response.ok) {", '  const retryAfter = response.headers.get("retry-after");',
      '  if (retryAfter) res.set("Retry-After", retryAfter);',
      '  return res.status(response.status).type("application/json").send(await response.text());', "}",
      'res.set("Cache-Control", "no-store");',
      endpoint.output === "wav" ? 'res.status(response.status).type("audio/wav").send(Buffer.from(await response.arrayBuffer()));'
        : "res.status(response.status).json(await response.json());",
    ].map((line) => `      ${line}`),
    "    } catch (error) {", "      next(error);", "    }", "  });", "  return router;", "}",
  ].join("\n");

  const phpRequest = [
    "$key = config('services.bondeth.key');", "if (!$key) {", "    throw new \\RuntimeException('Configure services.bondeth.key');", "}",
    "$client = Http::withHeaders(['X-API-Key' => $key])", "    ->connectTimeout(10)->timeout(120);",
    ...(file ? [`$client = $client->attach(${phpLiteral(file[0])},`, `    file_get_contents(storage_path(${phpLiteral(`app/private/${file[1].slice(1)}`)})), ${phpLiteral(file[1].slice(1))});`] : []),
    `$response = $client->${endpoint.method.toLowerCase()}(${phpLiteral(url)}${endpoint.json ? `, ${phpLiteral(endpoint.json)}` : endpoint.form ? `, ${phpLiteral(fields)}` : ""});`,
  ];
  const laravel = [
    "<?php", "// app/Services/BondethClient.php", "namespace App\\Services;", "",
    "use Illuminate\\Support\\Facades\\Http;", ...(endpoint.output === "wav" ? ["use Illuminate\\Support\\Facades\\Storage;"] : []), "",
    "final class BondethClient", "{", `    public function call(): ${endpoint.output === "wav" ? "string" : "array"}`, "    {",
    ...[...phpRequest, "$response->throw();",
      ...(endpoint.output === "wav" ? ["Storage::disk('local')->put('speech.wav', $response->body());", "return 'speech.wav';"] : ["return $response->json();"]),
    ].map((line) => `        ${line}`), "    }", "}",
  ].join("\n");
  return { python, nextjs, express, laravel };
}
