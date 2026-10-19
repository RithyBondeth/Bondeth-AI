"use client";

import { useT } from "@/lib/useLocale";

import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, UserRound, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps, type ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import { Logo } from "@/components/Logo";
import {
  ListenerDoodle, ReaderDoodle, SparkleDoodle, SpeakerDoodle, SpeechBubbleDoodle, TwinVoicesDoodle, UnlockDoodle, WaveformDoodle,
} from "@/components/doodles";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, Field, Input, cx, useToast } from "@/components/ui";
import { ApiError, login, register } from "@/lib/api";

/** Where to go after signing in: a same-site path from ?next=, else the studio. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/stt";
}

/** Icons are decorative; persistent labels still name each field for assistive technology. */
function AuthInput({ Icon, className, type, ...props }: ComponentProps<typeof Input> & { Icon: LucideIcon }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const password = type === "password";
  const VisibilityIcon = visible ? EyeOff : Eye;
  return (
    <div className="group/auth-input relative">
      <Icon aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-soft transition-colors group-focus-within/auth-input:text-accent" />
      <Input {...props} type={password && visible ? "text" : type}
        className={cx("h-12 rounded-xl pl-11", password && "pr-12", className)} />
      {password && (
        <button type="button" onClick={() => setVisible((value) => !value)}
          aria-label={t(visible ? "Hide password" : "Show password")} aria-controls={props.id} aria-pressed={visible}
          className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink">
          <VisibilityIcon aria-hidden className="size-[18px]" />
        </button>
      )}
    </div>
  );
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === "login";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    try {
      const user = isLogin
        ? await login(email, password)
        : await register(email, password, String(form.get("full_name") || ""));
      if (isLogin || user.email_verified) {
        toast(isLogin ? "Welcome back, {name}!" : "Welcome, {name}!", "success", { name: user.full_name || user.email });
      } else {
        toast("Welcome! We sent a link to {email}: confirm it to unlock your full allowance.", "success", { email: user.email });
      }
      router.push(nextPath());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      km={isLogin ? "ចូលគណនី" : "បង្កើតគណនី"}
      title={isLogin ? t("Welcome back") : t("Create your account")}
      subtitle={isLogin ? t("Sign in to clone voices and keep your transcripts.") : t("Free. Save voices and your transcription history.")}
      bubble={isLogin ? "ជំរាបសួរ" : "ស្វាគមន៍"}
      art={isLogin ? "clone" : "speaker"}
    >
      <form onSubmit={submit} className="space-y-4">
        {!isLogin && (
          <Field label={t("Name (optional)")} hideLabel>
            {(id) => <AuthInput Icon={UserRound} id={id} name="full_name" autoComplete="name" maxLength={100} placeholder={t("Name (optional)")} />}
          </Field>
        )}
        <Field label={t("Email")} hideLabel>
          {(id) => <AuthInput Icon={Mail} id={id} name="email" type="email" required autoComplete="email" placeholder={t("Email address")} />}
        </Field>
        <Field label={t("Password")} hideLabel>
          {(id) => (
            <AuthInput Icon={KeyRound} id={id} name="password" type="password" required minLength={isLogin ? undefined : 8}
              placeholder={t(isLogin ? "Enter your password" : "Create a password (8+ characters)")}
              autoComplete={isLogin ? "current-password" : "new-password"} />
          )}
        </Field>
        {isLogin && <div className="flex justify-end">
          <Link href="/forgot-password" className="rounded text-xs font-medium text-accent hover:underline">{t("Forgot your password?")}</Link>
        </div>}

        {error && (
          <motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
            className="rounded-xl bg-rose-soft px-4 py-2.5 text-sm text-rose">
            {t(error)}
          </motion.p>
        )}

        <Button type="submit" loading={busy} className="w-full" size="lg">
          {isLogin ? t("Sign in") : t("Create account")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {isLogin ? t("New here? ") : t("Already have an account? ")}
        <Link href={isLogin ? "/register" : "/login"} className="font-medium text-accent hover:underline">
          {isLogin ? t("Create an account") : t("Sign in")}
        </Link>
      </p>
    </AuthShell>
  );
}

const AUTH_ART = {
  clone: { Art: TwinVoicesDoodle, label: "A speaker and her dashed-outline voice clone with a hand-drawn audio waveform" },
  speaker: { Art: SpeakerDoodle, label: "A Cambodian woman speaking into a studio microphone" },
  key: { Art: UnlockDoodle, label: "A doodle of a padlock, key, and envelope" },
  listener: { Art: ListenerDoodle, label: "A Cambodian man listening with headphones" },
  reader: { Art: ReaderDoodle, label: "A doodle of someone capturing an idea with a phone and notebook" },
};

/** Split-screen frame shared by the sign-in, sign-up and account-recovery pages; each page picks its own character. */
export function AuthShell({ km, title, subtitle, bubble = "សួស្តី", art = "clone", children }: {
  km: string; title: string; subtitle: ReactNode; bubble?: string; art?: keyof typeof AUTH_ART; children: ReactNode;
}) {
  const t = useT();
  const { Art, label } = AUTH_ART[art];
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden border-r-2 border-dashed border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10">
        <Logo className="self-start" />
        <div className="relative mx-auto w-full max-w-md">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 100, damping: 16 }}>
            <Art key={art} className="w-full text-ink" label={t(label)} />
          </motion.div>
          <motion.div className="absolute -top-16 right-0" animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity }}>
            <SpeechBubbleDoodle className="h-24 w-28 text-ink" text={bubble} />
          </motion.div>
          <SparkleDoodle className="absolute -left-4 top-0 size-8" />
          <WaveformDoodle className="mx-auto mt-6 h-12 w-36 text-ink" />
        </div>
        <blockquote className="max-w-md">
          <p className="khmer text-lg">“សំឡេងរបស់អ្នក ជាភាសារបស់អ្នក។”</p>
          <p className="mt-1 text-sm text-ink-soft">{t("Your voice, in your language. Khmer-first voice tools, free and open source.")}</p>
        </blockquote>
      </div>

      {/* Form */}
      <div className="relative flex flex-col">
        <Aurora />
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink">
            <ArrowLeft className="size-4" /> {t(" Home")}</Link>
          <div role="group" aria-label={t("Language and appearance")} className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-surface p-1">
            <LanguageSwitch />
            <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className="w-full max-w-sm">
            <p className="secondary-khmer khmer text-sm text-accent">{km}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mb-8 mt-1 text-ink-soft">{subtitle}</p>
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
