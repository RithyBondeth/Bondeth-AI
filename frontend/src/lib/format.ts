import { getLocale, INTL_LOCALE } from "./i18n";

export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(INTL_LOCALE[getLocale()], { dateStyle: "medium", timeStyle: "short" });
}

export const LANG_LABEL: Record<string, string> = { km: "ខ្មែរ", en: "English", auto: "Auto" };

/** File extension the backend accepts for a recorded MIME type (Chrome: webm, Safari: mp4). */
export function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

export function formatTime(iso: string | number): string {
  return new Date(iso).toLocaleTimeString(INTL_LOCALE[getLocale()], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(INTL_LOCALE[getLocale()]);
}
