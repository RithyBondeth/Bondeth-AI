"use client";

import { useT } from "@/lib/useLocale";

import { Check, Copy, KeyRound, Plus, Trash2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { DeveloperDoodle } from "@/components/doodles";
import { Intro, RequireAuth, errorText } from "@/components/studios/shared";
import { Button, Dialog, EmptyState, Field, IconButton, Input, Panel, PanelHeader, useToast } from "@/components/ui";
import { API_URL, api, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ApiKey, ApiKeyCreated, ApiKeyUsageDay } from "@/lib/types";

export function ApiKeysLibrary() {
  const t = useT();
  return (
    <>
      <Intro>
        {t("Call speech-to-text, text-to-speech and voice cloning from your own apps. Requests made with a key share your daily allowance, and each key's usage is tracked separately.")}</Intro>
      <RequireAuth why={t("API keys belong to your account.")}>
        <Keys />
      </RequireAuth>
    </>
  );
}

function Keys() {
  const t = useT();
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);

  const reload = useCallback(async () => {
    try {
      setKeys(await apiJson<ApiKey[]>("/api/v1/api-keys", { auth: "required" }));
    } catch (err) {
      setKeys([]);
      toast(errorText(err, "Couldn't load your API keys."), "error");
    }
  }, [toast]);

  useEffect(() => {
    // Initial fetch; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const revoke = async (key: ApiKey) => {
    if (!confirm(t("Revoke “{name}”? Apps using it stop working immediately.", { name: key.name }))) return;
    try {
      await api(`/api/v1/api-keys/${key.id}`, { method: "DELETE", auth: "required" });
      setKeys((list) => list?.filter((k) => k.id !== key.id) ?? null);
      toast(t("Revoked “{name}”", { name: key.name }));
    } catch (err) {
      toast(errorText(err, "Couldn't revoke the key."), "error");
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <div className="mb-4 flex items-center gap-3">
          <p className="text-sm text-ink-soft">{keys ? t("{count} active", { count: keys.length }) : t("Loading…")}</p>
          <Button className="ml-auto" onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>{t("New key")}</Button>
        </div>

        {keys === null ? (
          <div className="space-y-3">{[0, 1].map((k) => <div key={k} className="h-28 animate-pulse rounded-2xl bg-surface" />)}</div>
        ) : keys.length === 0 ? (
          <Panel>
            <EmptyState doodle={<DeveloperDoodle className="h-32 w-48" />} title={t("No API keys yet")}
              action={<Button onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>{t("Create your first key")}</Button>}>
              {t("Create a key for each app or bot, so you can see what each one uses and revoke it on its own.")}</EmptyState>
          </Panel>
        ) : (
          <motion.ul layout className="space-y-3">
            <AnimatePresence initial={false}>
              {keys.map((k) => <KeyRow key={k.id} apiKey={k} onRevoke={() => revoke(k)} />)}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>

      <QuickStart />

      <Dialog open={creating} onClose={() => setCreating(false)} title={t("New API key")}>
        <CreateKeyForm onCreated={(k) => {
          setCreating(false);
          setCreated(k);
          setKeys((list) => [k, ...(list ?? [])]);
        }} />
      </Dialog>
      <Dialog open={!!created} onClose={() => setCreated(null)} title={t("Copy your key")}>
        {created && <ShowOnce apiKey={created} onDone={() => setCreated(null)} />}
      </Dialog>
    </div>
  );
}

function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke: () => void }) {
  const t = useT();
  const [days, setDays] = useState<ApiKeyUsageDay[] | null>(null);

  useEffect(() => {
    let active = true;
    apiJson<ApiKeyUsageDay[]>(`/api/v1/api-keys/${apiKey.id}/usage?days=30`, { auth: "required" })
      .then((d) => active && setDays(d), () => active && setDays([]));
    return () => { active = false; };
  }, [apiKey.id]);

  const total = (field: keyof Omit<ApiKeyUsageDay, "day">) => (days ?? []).reduce((n, d) => n + d[field], 0);

  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-panel">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <KeyRound className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{apiKey.name}</p>
          <p className="truncate font-mono text-xs text-ink-soft">{apiKey.prefix}…</p>
          <p className="mt-1 text-xs text-ink-faint">
            {t("Created ")}{formatDate(apiKey.created_at)} · {apiKey.last_used_at ? t("last used {date}", { date: formatDate(apiKey.last_used_at) }) : t("never used")}
          </p>
        </div>
        <IconButton label={t("Revoke {name}", { name: apiKey.name })} onClick={onRevoke} className="hover:text-rose">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("Requests")} value={days && total("requests").toLocaleString()} />
        <Stat label={t("Transcribed")} value={days && t("{count} min", { count: Math.ceil(total("stt_seconds") / 60) })} />
        <Stat label={t("Spoken")} value={days && t("{count} chars", { count: total("tts_chars").toLocaleString() })} />
        <Stat label={t("Clones")} value={days && total("clone_jobs").toLocaleString()} />
      </dl>
      <p className="mt-2 text-[11px] text-ink-faint">{t("Last 30 days")}</p>
    </motion.li>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-[11px] text-ink-soft">{label}</dt>
      <dd className="tabular-nums text-sm font-medium">{value ?? <span className="text-ink-faint">…</span>}</dd>
    </div>
  );
}

function CreateKeyForm({ onCreated }: { onCreated: (k: ApiKeyCreated) => void }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await apiJson<ApiKeyCreated>("/api/v1/api-keys", {
        method: "POST", auth: "required",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      }));
    } catch (err) {
      toast(errorText(err, "Couldn't create the key."), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="space-y-4">
      <Field label={t("Name")} hint={t("What it's for, so you can tell keys apart later.")}>
        {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100}
          placeholder={t("e.g. Telegram bot")} autoFocus />}
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!name.trim()}>{t("Create key")}</Button>
    </form>
  );
}

function ShowOnce({ apiKey, onDone }: { apiKey: ApiKeyCreated; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(apiKey.key);
    setCopied(true);
  };

  return (
    <div className="space-y-4">
      <p className="flex gap-2.5 rounded-xl bg-accent-soft p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" />
        {t("This is the only time the key is shown. Store it somewhere safe, like a password manager or your server's secrets.")}</p>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-2 pl-3">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">{apiKey.key}</code>
        <Button variant="secondary" size="sm" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
          {copied ? t("Copied") : t("Copy")}
        </Button>
      </div>
      <Button className="w-full" onClick={onDone}>{t("Done")}</Button>
    </div>
  );
}

function QuickStart() {
  const t = useT();
  const examples = [
    { title: "Speech to text", code: `curl ${API_URL}/api/v1/stt \\\n  -H "X-API-Key: $BONDETH_API_KEY" \\\n  -F file=@recording.mp3` },
    { title: "Text to speech", code: `curl ${API_URL}/api/v1/tts \\\n  -H "X-API-Key: $BONDETH_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "សួស្តី"}' -o speech.wav` },
  ];
  return (
    <Panel className="h-fit min-w-0">
      <PanelHeader title={t("Quick start")} km="ចាប់ផ្តើម" />
      <div className="space-y-4 p-5 text-sm">
        {examples.map((ex) => (
          <div key={ex.title} className="space-y-1.5">
            <p className="font-medium">{t(ex.title)}</p>
            <pre className="scroll-thin overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed">{ex.code}</pre>
          </div>
        ))}
        <p className="text-xs text-ink-soft">
          <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> {t(" works too. Every endpoint is described in the")}{" "}
          <Link href="/api" className="font-medium text-accent hover:underline">{t("API docs")}</Link>.
        </p>
      </div>
    </Panel>
  );
}
