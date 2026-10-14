"use client";

import { CircleCheck, KeyRound, MailWarning, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Intro, RequireAuth, errorText } from "@/components/studios/shared";
import { Badge, Button, Dialog, Field, Input, Panel, PanelHeader, useToast } from "@/components/ui";
import { api, apiJson, clearSession, type User } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useUser } from "@/lib/hooks";

export function AccountSettings() {
  return (
    <>
      <Intro>Your profile, email confirmation and password, and deleting your account.</Intro>
      <RequireAuth why="Sign in to manage your account.">
        <Account />
      </RequireAuth>
    </>
  );
}

/** Ask for a fresh verification link. Shared by the account page and the studio banner. */
export function useResendVerification() {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const resend = async (email: string) => {
    setSending(true);
    try {
      await api("/api/v1/auth/verify-email/resend", { method: "POST", auth: "required" });
      toast(`Sent a new link to ${email}`, "success");
    } catch (err) {
      toast(errorText(err, "Couldn't send the link."), "error");
    } finally {
      setSending(false);
    }
  };
  return { resend, sending };
}

function Account() {
  const user = useUser()!;
  const toast = useToast();
  const { resend, sending } = useResendVerification();
  const [resetBusy, setResetBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sendReset = async () => {
    setResetBusy(true);
    try {
      await apiJson("/api/v1/auth/password-reset", {
        method: "POST", auth: "none", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email }),
      });
      toast(`Sent a password reset link to ${user.email}`, "success");
    } catch (err) {
      toast(errorText(err, "Couldn't send the link."), "error");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Panel>
        <PanelHeader title="Profile" km="ប្រវត្តិរូប" />
        <dl className="divide-y divide-line text-sm">
          <Row label="Name">{user.full_name || <span className="text-ink-faint">Not set</span>}</Row>
          <Row label="Email">
            <span className="flex flex-wrap items-center gap-2">
              {user.email}
              {user.email_verified
                ? <Badge tone="teal"><CircleCheck className="size-3" /> Confirmed</Badge>
                : <Badge tone="rose"><MailWarning className="size-3" /> Not confirmed</Badge>}
            </span>
          </Row>
          <Row label="Member since">{formatDate(user.created_at)}</Row>
        </dl>
        {user.email_verified === false && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
            <p className="flex-1 text-sm text-ink-soft">
              Confirm your email to unlock voice cloning, API keys and the full daily allowance.
            </p>
            <Button variant="secondary" size="sm" loading={sending} onClick={() => resend(user.email)}>Resend link</Button>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Password" km="ពាក្យសម្ងាត់" />
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <p className="flex-1 text-sm text-ink-soft">
            To change your password, we&apos;ll email you a link. Changing it signs you out on every device.
          </p>
          <Button variant="secondary" size="sm" loading={resetBusy} onClick={sendReset} icon={<KeyRound className="size-4" />}>
            Email me a link
          </Button>
        </div>
      </Panel>

      <Panel className="border-rose/40">
        <PanelHeader title="Delete account" km="លុបគណនី" />
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <p className="flex-1 text-sm text-ink-soft">
            Permanently removes your account and everything in it. This can&apos;t be undone.
          </p>
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)} icon={<Trash2 className="size-4" />}>
            Delete account
          </Button>
        </div>
      </Panel>

      <Dialog open={deleting} onClose={() => setDeleting(false)} title="Delete your account?">
        <DeleteAccountForm user={user} />
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function DeleteAccountForm({ user }: { user: User }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/me", {
        method: "DELETE", auth: "required", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      clearSession();
      toast("Your account was deleted. លាហើយ!", "success");
      router.push("/");
    } catch (err) {
      setError(errorText(err, "Couldn't delete the account."));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2 text-sm">
        <p>This permanently deletes <strong>{user.email}</strong> and:</p>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          <li>your transcription history</li>
          <li>your saved voices and their audio samples</li>
          <li>your API keys (apps using them stop working) and their usage records</li>
        </ul>
      </div>
      <Field label="Your password" hint="To make sure it's really you.">
        {(id) => <Input id={id} name="password" type="password" required autoComplete="current-password" autoFocus />}
      </Field>
      {error && <p role="alert" className="rounded-xl bg-rose-soft px-4 py-2.5 text-sm text-rose">{error}</p>}
      <Button type="submit" className="w-full !bg-rose !text-white" size="lg" loading={busy} icon={<Trash2 className="size-4" />}>
        Delete my account forever
      </Button>
    </form>
  );
}
