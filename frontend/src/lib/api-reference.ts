import { API_URL } from "@/lib/api";
import { frameworkExamples } from "@/lib/api-framework-examples";

export const API_BASE = `${API_URL}/api/v1`;

export const EXAMPLE_TARGETS = [
  ["curl", "cURL"], ["javascript", "JavaScript"], ["python", "Python"],
  ["nextjs", "Next.js"], ["express", "Express"], ["laravel", "Laravel"], ["response", "Example response"],
] as const;
export type ExampleTarget = (typeof EXAMPLE_TARGETS)[number][0];

type Parameter = { name: string; type: string; detail: string };
export type ApiEndpoint = {
  id: string; title: string; method: "GET" | "POST"; path: string; description: string;
  authenticated?: boolean; parameters: Parameter[]; json?: Record<string, unknown>;
  form?: Record<string, string>; output: "json" | "wav"; response: string;
};

export const API_ENDPOINTS: ApiEndpoint[] = [
  { id: "text-to-speech", title: "Text to Speech", method: "POST", path: "/tts", output: "wav",
    description: "Generate a WAV file from Khmer, English, or mixed-language text.",
    parameters: [
      { name: "text", type: "string · required", detail: "The text to speak." },
      { name: "lang", type: "auto | km | en", detail: "Defaults to auto. Sets the primary language for reading numbers." },
      { name: "speed", type: "number · 0.5–2.0", detail: "Playback speed. Defaults to 1.0." },
    ], json: { text: "សួស្តី! Welcome to Bondeth AI.", lang: "auto", speed: 1 },
    response: "HTTP 200 · audio/wav\n\nBinary WAV audio. Save the response as speech.wav.\nHeaders: X-Audio-Duration, X-TTS-Engine, X-TTS-Fallback, X-Cache\nX-Audio-Id is included when audio is saved to your account." },
  { id: "speech-to-text", title: "Speech to Text", method: "POST", path: "/stt", output: "json",
    description: "Upload a short recording and receive editable text with timestamped segments.",
    parameters: [
      { name: "file", type: "audio file · required", detail: "Upload an audio file such as WAV, MP3, M4A, or WebM." },
      { name: "language", type: "auto | km | en", detail: "Defaults to auto. Choose km or en to specify the language." },
      { name: "keep_source_audio", type: "boolean", detail: "Defaults to false. Keeping source audio requires authentication." },
    ], form: { file: "@recording.mp3", language: "auto" },
    response: JSON.stringify({ status: "success", detected_language: "km", language_probability: 0.98, duration: 2.4,
      text: "សួស្តី", segmented_text: "សួស្តី", segments: [{ start: 0, end: 2.4, text: "សួស្តី" }], transcription_id: null }, null, 2) },
  { id: "transcription-jobs", title: "Transcription jobs", method: "POST", path: "/stt/jobs", output: "json",
    description: "Queue a longer recording, then poll its status or stream transcript segments.",
    parameters: [
      { name: "file", type: "audio file · required", detail: "The recording to transcribe." },
      { name: "language", type: "auto | km | en", detail: "Defaults to auto." },
      { name: "keep_source_audio", type: "boolean", detail: "Defaults to false. Keeping source audio requires authentication." },
    ], form: { file: "@recording.mp3", language: "auto" },
    response: "HTTP 202 · application/json\n\n{\n  \"job_id\": \"<job_id>\",\n  \"status\": \"queued\",\n  \"status_url\": \"<base_url>/stt/jobs/<job_id>\",\n  \"events_url\": \"<base_url>/stt/jobs/<job_id>/events\"\n}\n\nPoll status_url or follow events_url with an authenticated SSE client.\nStatuses: queued → running → done | failed.\nThe completed job includes result; a failed job includes error.\nKeep authentication headers on requests for your private jobs." },
  { id: "speech-preview", title: "Speech preview", method: "POST", path: "/tts/preview", output: "json",
    description: "Inspect normalized speech chunks before generating audio.",
    parameters: [
      { name: "text", type: "string · required", detail: "The text to preview." },
      { name: "lang", type: "auto | km | en", detail: "Defaults to auto." },
    ], json: { text: "Hello, Bondeth!", lang: "en" },
    response: JSON.stringify({ primary_lang: "en", engine: "<configured engine>", chunks: [{ lang: "en", text: "Hello, Bondeth!" }] }, null, 2) },
  { id: "voice-cloning", title: "Voice Clone", method: "POST", path: "/clone", output: "json", authenticated: true,
    description: "Queue speech using a saved voice or an explicitly consented reference recording.",
    parameters: [
      { name: "text", type: "string · required", detail: "What the cloned voice should say." },
      { name: "reference_audio / voice_id", type: "file / UUID · one required", detail: "Provide exactly one: a 3–30 second sample or a saved voice ID." },
      { name: "consent", type: "boolean", detail: "Must be true when uploading a reference. Only clone voices you own or have permission to use." },
      { name: "reference_text", type: "string · optional", detail: "The reference transcript. Transcribed automatically when omitted." },
      { name: "lang / speed", type: "auto | km | en / 0.5–2.0", detail: "Defaults to auto and 1.0. reuse_cached defaults to true." },
    ], form: { text: "សួស្តី!", reference_audio: "@voice.wav", consent: "true", lang: "km" },
    response: "HTTP 202 · application/json\n\n{\n  \"job_id\": \"<job_id>\",\n  \"status\": \"queued\",\n  \"status_url\": \"<base_url>/clone/jobs/<job_id>\",\n  \"audio_url\": null\n}\n\nPoll status_url until status is done or failed.\nWhen done, download audio_url with the same authentication headers.\nWhen failed, inspect error. Voice cloning requires a verified account." },
  { id: "saved-voices", title: "Saved voices", method: "GET", path: "/voices", output: "json", authenticated: true,
    description: "List your saved voice samples and use their IDs in cloning requests.", parameters: [],
    response: JSON.stringify([{ id: "<voice_id>", voice_alias: "My voice", reference_text: "សួស្តី", reference_duration_seconds: 12,
      consent_confirmed_at: "<ISO 8601 timestamp>", created_at: "<ISO 8601 timestamp>" }], null, 2) },
  { id: "usage", title: "Usage and limits", method: "GET", path: "/usage", output: "json",
    description: "Read your current allowance, usage, and next reset time. Limits depend on the installation and plan.", parameters: [],
    response: JSON.stringify({ signed_in: true, account: "verified", plan: "free", resets_at: "<ISO 8601 timestamp>",
      quotas: { tts_chars: { used: 0, limit: "<configured allowance or null>", remaining: "<remaining allowance or null>" } } }, null, 2) },
];

export function endpointExamples(endpoint: ApiEndpoint) {
  const url = `${API_BASE}${endpoint.path}`;
  const curl = [`curl ${endpoint.method === "POST" ? "-X POST " : ""}"${url}"`, '  -H "X-API-Key: $BONDETH_API_KEY"'];
  if (endpoint.json) curl.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(endpoint.json)}'`);
  if (endpoint.form) Object.entries(endpoint.form).forEach(([key, value]) => curl.push(`  -F '${key}=${value}'`));
  if (endpoint.output === "wav") curl.push("  --output speech.wav");
  const imports: string[] = [];
  const setup: string[] = [];
  if (endpoint.form) {
    imports.push('import { readFile } from "node:fs/promises";');
    setup.push("const form = new FormData();");
    Object.entries(endpoint.form).forEach(([key, value]) => setup.push(value.startsWith("@")
      ? `form.set("${key}", new Blob([await readFile("${value.slice(1)}")]), "${value.slice(1)}");`
      : `form.set("${key}", ${JSON.stringify(value)});`));
  }
  if (endpoint.output === "wav") imports.push('import { writeFile } from "node:fs/promises";');
  const js = [...imports, ...setup, `const response = await fetch(${JSON.stringify(url)}, {`,
    `  method: "${endpoint.method}",`, "  headers: {", '    "X-API-Key": process.env.BONDETH_API_KEY,',
    ...(endpoint.json ? ['    "Content-Type": "application/json",'] : []), "  },",
    ...(endpoint.json ? [`  body: JSON.stringify(${JSON.stringify(endpoint.json)}),`] : endpoint.form ? ["  body: form,"] : []),
    "});", "if (!response.ok) throw new Error(await response.text());",
    endpoint.output === "wav" ? 'await writeFile("speech.wav", Buffer.from(await response.arrayBuffer()));' : "console.log(await response.json());"].join("\n");
  return { curl: curl.join(" \\\n"), javascript: js, ...frameworkExamples(endpoint, url), response: endpoint.response };
}
