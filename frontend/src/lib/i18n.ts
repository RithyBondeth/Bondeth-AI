import { khmerMessages } from "./messages-km";

export type Locale = "en" | "km";
export const LOCALE_STORAGE_KEY = "bondeth.locale";
export const INTL_LOCALE = { en: "en-US", km: "km-KH" } as const;
export type MessageValues = Record<string, string | number>;

// Existing API responses contain English messages. Match only known UI errors;
// preserve unknown diagnostics so operators can still diagnose model failures.
const ERROR_PATTERNS: [RegExp, string, string[]][] = [
  [/^Text exceeds (\d+) characters$/, "Text exceeds {count} characters", ["count"]],
  [/^You can save up to (\d+) voices\. Delete one first\.$/, "You can save up to {count} voices. Delete one first.", ["count"]],
  [/^You can have up to (\d+) API keys\. Revoke one first\.$/, "You can have up to {count} API keys. Revoke one first.", ["count"]],
  [/^File exceeds the (\d+) MB limit$/, "File exceeds the {count} MB limit", ["count"]],
  [/^Request failed \((\d+)\)$/, "Request failed ({status})", ["status"]],
];

function quantity(locale: Locale, source: string): string {
  const match = /^([\d,]+) (min|s|characters|clone jobs?)$/.exec(source);
  if (!match) return source;
  const unit = match[2].startsWith("clone job") ? "clone jobs" : match[2];
  return translate(locale, `{count} ${unit}`, { count: match[1] });
}

/** Quota and rate-limit messages include server-configured amounts and reset zones. */
function limitMessage(locale: Locale, source: string): string | undefined {
  const retry = /^(.*) Try again in (\d+ (?:s|min))\.$/.exec(source);
  if (retry) return `${translate(locale, retry[1])} ${translate(locale, "Try again in {duration}.", { duration: quantity(locale, retry[2]) })}`;

  const reset = /^(.*) It resets at midnight \(UTC([+-]\d+)\)\.$/.exec(source);
  if (!reset) return undefined;
  let body = reset[1];
  const extra = / (Verify your email for a larger allowance\.|Sign in for a larger allowance\.)$/.exec(body);
  if (extra) body = body.slice(0, -extra[0].length);
  const needs = /^This needs (.+) of (speech-to-text|text-to-speech|voice cloning) but only (.+) of today's allowance is left\.$/.exec(body);
  const used = /^You've used today's (speech-to-text|text-to-speech|voice cloning) allowance \((.+)\)\.$/.exec(body);
  const account = /^(Verify your email|Sign in) to use (speech-to-text|text-to-speech|voice cloning)\.$/.exec(body);
  let translated: string;
  if (needs) translated = translate(locale, "This needs {amount} of {tool} but only {remaining} of today's allowance is left.",
    { amount: quantity(locale, needs[1]), tool: translate(locale, needs[2]), remaining: quantity(locale, needs[3]) });
  else if (used) translated = translate(locale, "You've used today's {tool} allowance ({amount}).",
    { tool: translate(locale, used[1]), amount: quantity(locale, used[2]) });
  else if (account) translated = translate(locale, account[1] === "Sign in" ? "Sign in to use {tool}." : "Verify your email to use {tool}.",
    { tool: translate(locale, account[2]) });
  else return undefined;
  return `${translated}${extra ? ` ${translate(locale, extra[1])}` : ""} ${translate(locale, "It resets at midnight (UTC{offset}).", { offset: reset[2] })}`;
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "km";
}

/** Only authored UI copy belongs here. Speech text, names, keys and exports stay untouched. */
export function translate(locale: Locale, message: string, values?: MessageValues): string {
  const key = message.trim().replace(/\s+/g, " ");
  let translated = locale === "km" && Object.hasOwn(khmerMessages, key) ? khmerMessages[key] : undefined;
  if (locale === "km" && translated === undefined) {
    for (const [pattern, template, names] of ERROR_PATTERNS) {
      const match = pattern.exec(key);
      if (match) {
        translated = translate(locale, template, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
        break;
      }
    }
    translated ??= limitMessage(locale, key);
  }
  const text = translated === undefined ? message : `${message.match(/^\s*/)?.[0] ?? ""}${translated}${message.match(/\s*$/)?.[0] ?? ""}`;
  return values ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)) : text;
}

let current: Locale | undefined;
const listeners = new Set<() => void>();
function readPreference(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : "en";
  } catch { return "en"; }
}
export function getLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return current ??= readPreference();
}
function publish(locale: Locale) {
  current = locale;
  document.documentElement.lang = locale;
  listeners.forEach((listener) => listener());
}
export function setLocale(locale: Locale) {
  if (!isLocale(locale)) return;
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Keep the choice in memory when storage is blocked. */ }
  publish(locale);
}
function onStorage(event: StorageEvent) {
  if (event.key === LOCALE_STORAGE_KEY || event.key === null) publish(readPreference());
}
export function subscribeLocale(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
export const getServerLocale = (): Locale => "en";
export const localeInitScript = `(function(){try{var l=localStorage.getItem("${LOCALE_STORAGE_KEY}");document.documentElement.lang=l==="km"?"km":"en"}catch(e){}})()`;
