"use client";

import { useT } from "@/lib/useLocale";

import { CircleCheck, CircleX, MailCheck } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AuthShell } from "@/components/AuthForm";
import { Button, Field, Input } from "@/components/ui";
import { ApiError, apiJson, clearSession, refreshUser, sessionStore, type User } from "@/lib/api";

/** The ?token= from an emailed link. Read after mount: the page is statically rendered. */
function linkToken(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function Outcome({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} role="status"
      className={ok ? "flex gap-3 rounded-xl bg-teal-soft p-4 text-sm" : "flex gap-3 rounded-xl bg-rose-soft p-4 text-sm"}>
      <Icon className={ok ? "mt-0.5 size-5 shrink-0 text-teal" : "mt-0.5 size-5 shrink-0 text-rose"} />
      <div className="space-y-2">{children}</div>
    </motion.div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  const t = useT();
  if (!error) return null;
  return (
    <motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
      className="rounded-xl bg-rose-soft px-4 py-2.5 text-sm text-rose">{t(error)}</motion.p>
  );
}

export function VerifyEmail() {
  const t = useT();
  const [state, setState] = useState<{ status: "working" | "done" | "failed"; detail?: string }>({ status: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // links are single-use: never send the token twice (Strict Mode)
    started.current = true;
    const token = linkToken();
    (async () => {
      try {
        if (!token) throw new ApiError(400, "This link is missing its token. Open the link from the email again.");
        await apiJson<User>("/api/v1/auth/verify-email", {
          method: "POST", auth: "none", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
        });
        if (sessionStore.get()) await refreshUser().catch(() => {});
        setState({ status: "done" });
      } catch (err) {
        setState({ status: "failed", detail: message(err, "Couldn't verify your email. Please try again.") });
      }
    })();
  }, []);

  return (
    <AuthShell km="បញ្ជាក់អ៊ីមែល" title={t("Confirm your email")} subtitle={t("One click and your full daily allowance is unlocked.")} bubble="អរគុណ" art="reader">
      {state.status === "working" ? (
        <p className="text-sm text-ink-soft">{t("Checking your link…")}</p>
      ) : state.status === "done" ? (
        <Outcome ok>
          <p className="font-medium">{t("Your email is confirmed.")}</p>
          <p className="text-ink-soft">{t("Voice cloning, API keys and the full daily allowance are now on.")}</p>
          <Link href="/stt" className="inline-block font-medium text-accent hover:underline">{t("Open the studio →")}</Link>
        </Outcome>
      ) : (
        <Outcome ok={false}>
          <p className="font-medium">{state.detail && t(state.detail)}</p>
          <Link href="/account" className="inline-block font-medium text-accent hover:underline">{t("Send a new link from your account →")}</Link>
        </Outcome>
      )}
    </AuthShell>
  );
}

export function ForgotPassword() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setBusy(true);
    setError(null);
    try {
      await apiJson("/api/v1/auth/password-reset", {
        method: "POST", auth: "none", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      setSentTo(email);
    } catch (err) {
      setError(message(err, "Couldn't send the link. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell km="ភ្លេចពាក្យសម្ងាត់" title={t("Forgot your password?")} subtitle={t("We'll email you a link to choose a new one.")} bubble="កុំបារម្ភ" art="key">
      {sentTo ? (
        <Outcome ok>
          <p className="flex items-center gap-2 font-medium"><MailCheck className="size-4" /> {t(" Check your inbox")}</p>
          <p className="text-ink-soft">
            {t("If an account exists for ")}<strong className="text-ink">{sentTo}</strong>{t(", a reset link is on its way. It works once, for an hour.")}</p>
        </Outcome>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("Email")}>
            {(id) => <Input id={id} name="email" type="email" required autoComplete="email" placeholder="you@example.com" autoFocus />}
          </Field>
          <ErrorLine error={error} />
          <Button type="submit" loading={busy} className="w-full" size="lg">{t("Send reset link")}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-ink-soft">
        {t("Remembered it? ")}<Link href="/login" className="font-medium text-accent hover:underline">{t("Sign in")}</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiJson("/api/v1/auth/password-reset/confirm", {
        method: "POST", auth: "none", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: linkToken(), new_password: password }),
      });
      clearSession(); // every existing session was just signed out, this one included
      setDone(true);
    } catch (err) {
      setError(message(err, "Couldn't change the password. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell km="ប្តូរពាក្យសម្ងាត់" title={t("Choose a new password")} subtitle={t("You'll be signed out on every device.")} bubble="ល្អណាស់" art="listener">
      {done ? (
        <Outcome ok>
          <p className="font-medium">{t("Your password is changed.")}</p>
          <Link href="/login" className="inline-block font-medium text-accent hover:underline">{t("Sign in with it →")}</Link>
        </Outcome>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("New password")} hint={t("At least 8 characters.")}>
            {(id) => <Input id={id} name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />}
          </Field>
          <Field label={t("Repeat it")}>
            {(id) => <Input id={id} name="confirm" type="password" required minLength={8} autoComplete="new-password" />}
          </Field>
          <ErrorLine error={error} />
          <Button type="submit" loading={busy} className="w-full" size="lg">{t("Change password")}</Button>
          <p className="text-center text-sm text-ink-soft">
            {t("Link expired? ")}<Link href="/forgot-password" className="font-medium text-accent hover:underline">{t("Get a new one")}</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
