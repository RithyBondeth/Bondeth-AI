"use client";

import { formatDay } from "@/lib/format";
import { useT } from "@/lib/useLocale";

import { useEffect, useState } from "react";

import { Button, Panel, PanelHeader } from "@/components/ui";
import { apiJson, notifyUsageChanged } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import { errorText } from "@/components/studios/shared";

type Billing = {
  enabled: boolean;
  plan: "free" | "pro";
  subscription_status: string | null;
  valid_until: string | null;
  can_manage: boolean;
  pro_quotas: { stt_seconds: number; tts_chars: number; clone_jobs: number };
};

export function BillingSettings() {
  const t = useT();
  const user = useUser();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const returning = new URLSearchParams(window.location.search).get("billing") === "success";
    const load = async () => {
      try {
        const next = await apiJson<Billing>("/api/v1/billing", { auth: "required" });
        if (!active) return;
        setBilling(next);
        setError(null);
        notifyUsageChanged();
        // Payment confirmation can arrive shortly after the Checkout redirect.
        if (returning && next.plan !== "pro" && attempts++ < 10) timer = setTimeout(load, 2000);
      } catch (err) {
        if (active) setError(errorText(err, "Couldn't load your plan."));
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [user?.id, user?.email_verified]);

  const open = async (kind: "checkout" | "portal") => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiJson<{ url: string }>(`/api/v1/billing/${kind}`, { method: "POST", auth: "required" });
      window.location.assign(result.url);
    } catch (err) {
      setError(errorText(err, "Couldn't open billing. Please try again."));
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHeader title={t("Plan & billing")} />
      <div className="space-y-3 px-5 py-4 text-sm">
        {error && <p role="alert" className="text-rose">{t(error)}</p>}
        {!billing ? <p className="text-ink-soft">{error ? t("Reload the page to try again.") : t("Loading your plan…")}</p> : (
          <>
            <p className="font-medium">{billing.plan === "pro" ? "Bondeth Pro" : t("Free plan")}</p>
            {!billing.enabled ? <p className="text-ink-soft">{t("Paid plans are not enabled on this installation.")}</p> : (
              <>
                <p className="text-ink-soft">
                  {t("Pro includes ")}{Math.floor(billing.pro_quotas.stt_seconds / 60).toLocaleString()} {t(" transcription minutes,")}{" "}{billing.pro_quotas.tts_chars.toLocaleString()} {t(" speech characters and")}{" "}{billing.pro_quotas.clone_jobs} {t(" clone jobs per day, with priority for queued jobs. Pricing and the billing interval are shown before you pay.")}</p>
                {billing.subscription_status && <p className="text-ink-soft">{t("Subscription: ")}{t(billing.subscription_status.replaceAll("_", " "))}</p>}
                {billing.valid_until && billing.plan === "pro" && (
                  <p className="text-ink-soft">{t("Current access period ends ")}{formatDay(billing.valid_until)}.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {billing.plan !== "pro" && <Button size="sm" loading={busy} disabled={!user?.email_verified}
                    onClick={() => open("checkout")}>{t("View Pro checkout")}</Button>}
                  {billing.can_manage && <Button variant="secondary" size="sm" loading={busy}
                    onClick={() => open("portal")}>{t("Manage subscription")}</Button>}
                </div>
                {!user?.email_verified && <p className="text-ink-soft">{t("Confirm your email to subscribe.")}</p>}
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
