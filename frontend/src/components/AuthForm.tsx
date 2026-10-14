"use client";

import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import { MicDoodle, SparkleDoodle, SpeechBubbleDoodle, TwinVoicesDoodle, WaveformDoodle } from "@/components/doodles";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, Field, Input, useToast } from "@/components/ui";
import { ApiError, login, register } from "@/lib/api";

/** Where to go after signing in: a same-site path from ?next=, else the studio. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/stt";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
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
      toast(isLogin || user.email_verified
        ? `Welcome${isLogin ? " back" : ""}, ${user.full_name || user.email}!`
        : `Welcome! We sent a link to ${user.email}: confirm it to unlock your full allowance.`, "success");
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
      title={isLogin ? "Welcome back" : "Create your account"}
      subtitle={isLogin ? "Sign in to clone voices and keep your transcripts." : "Free. Save voices and your transcription history."}
      bubble={isLogin ? "ជំរាបសួរ" : "សួស្តី"}
    >
      <form onSubmit={submit} className="space-y-4">
        {!isLogin && (
          <Field label="Name (optional)">
            {(id) => <Input id={id} name="full_name" autoComplete="name" maxLength={100} placeholder="Sokha" />}
          </Field>
        )}
        <Field label="Email">
          {(id) => <Input id={id} name="email" type="email" required autoComplete="email" placeholder="you@example.com" />}
        </Field>
        <Field label="Password" hint={isLogin
          ? <Link href="/forgot-password" className="font-medium text-accent hover:underline">Forgot your password?</Link>
          : "At least 8 characters."}>
          {(id) => (
            <Input id={id} name="password" type="password" required minLength={isLogin ? undefined : 8}
              autoComplete={isLogin ? "current-password" : "new-password"} />
          )}
        </Field>

        {error && (
          <motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
            className="rounded-xl bg-rose-soft px-4 py-2.5 text-sm text-rose">
            {error}
          </motion.p>
        )}

        <Button type="submit" loading={busy} className="w-full" size="lg">
          {isLogin ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {isLogin ? "New here? " : "Already have an account? "}
        <Link href={isLogin ? "/register" : "/login"} className="font-medium text-accent hover:underline">
          {isLogin ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </AuthShell>
  );
}

/** Split-screen frame shared by the sign-in, sign-up and account-recovery pages. */
export function AuthShell({ km, title, subtitle, bubble = "សួស្តី", children }: {
  km: string; title: string; subtitle: ReactNode; bubble?: string; children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="dot-grid relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent-soft"><MicDoodle className="h-7 w-6 text-ink" /></span>
          <span className="font-bold tracking-tight">Bondeth AI <span className="khmer font-normal text-ink-soft">· បណ្ឌិត</span></span>
        </Link>
        <div className="relative mx-auto w-full max-w-md">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 100, damping: 16 }}>
            <TwinVoicesDoodle className="w-full text-ink" label="Doodle of a face and its dashed voice clone" />
          </motion.div>
          <motion.div className="absolute -top-16 right-0" animate={{ y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity }}>
            <SpeechBubbleDoodle className="h-24 w-28 text-ink" text={bubble} />
          </motion.div>
          <SparkleDoodle className="absolute -left-4 top-0 size-8" />
          <WaveformDoodle className="mx-auto mt-6 h-12 w-36 text-ink" />
        </div>
        <blockquote className="max-w-md">
          <p className="khmer text-lg">“សំឡេងរបស់អ្នក ជាភាសារបស់អ្នក។”</p>
          <p className="mt-1 text-sm text-ink-soft">Your voice, in your language. Khmer-first voice tools, free and open source.</p>
        </blockquote>
      </div>

      {/* Form */}
      <div className="relative flex flex-col">
        <Aurora />
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink">
            <ArrowLeft className="size-4" /> Home
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className="w-full max-w-sm">
            <p className="khmer text-sm text-accent">{km}</p>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mb-8 mt-1 text-ink-soft">{subtitle}</p>
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
