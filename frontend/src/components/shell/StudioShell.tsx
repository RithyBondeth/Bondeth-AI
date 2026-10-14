"use client";

import { BookOpenText, Lock, LogIn, LogOut, MailWarning, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Aurora } from "@/components/Aurora";
import { MicDoodle, TwinVoicesDoodle } from "@/components/doodles";
import { RecentsProvider } from "@/components/shell/Recents";
import { UsageMeter } from "@/components/shell/UsageMeter";
import { useResendVerification } from "@/components/studios/AccountSettings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconButton, cx } from "@/components/ui";
import { API_URL, logout, refreshUser } from "@/lib/api";
import { useHydrated, useUser } from "@/lib/hooks";
import { LIBRARY, WORKSPACES, findNav, type NavItem } from "@/lib/nav";
import { toggleSidebar } from "@/lib/theme";

/*
 * Collapsed/expanded is an attribute on <html> set before first paint (lib/theme.ts),
 * so these `in-data-[sidebar=collapsed]:` styles apply with no layout jump.
 */
const WHEN_COLLAPSED_HIDE = "in-data-[sidebar=collapsed]:lg:hidden";

export function StudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const current = findNav(pathname);

  // Sync the stored user once per visit (email confirmed elsewhere, or a session ended by a password reset).
  useEffect(() => { refreshUser().catch(() => {}); }, []);

  // Close the mobile drawer whenever the route changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <RecentsProvider>
      <Aurora />
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-line bg-glass backdrop-blur-xl transition-[width] duration-300 in-data-[sidebar=collapsed]:w-[72px] lg:block">
          <SidebarContent pathname={pathname} />
        </aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {drawer && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDrawer(false)}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              <motion.aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface"
                initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 36 }}>
                <IconButton label="Close menu" onClick={() => setDrawer(false)} className="absolute right-3 top-3.5">
                  <X className="size-5" />
                </IconButton>
                <SidebarContent pathname={pathname} mobile />
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-glass px-4 backdrop-blur-xl sm:px-6">
            <IconButton label="Open menu" onClick={() => setDrawer(true)} className="lg:hidden">
              <Menu className="size-5" />
            </IconButton>
            {current && (
              <motion.div key={current.href} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <current.icon className="size-4" />
                </span>
                <div className="min-w-0 leading-tight">
                  <h1 className="truncate font-medium">{current.label}</h1>
                  <p className="khmer truncate text-xs leading-tight text-ink-soft">{current.km}</p>
                </div>
              </motion.div>
            )}
            <div className="ml-auto flex items-center gap-1">
              <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer"
                className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink sm:flex">
                <BookOpenText className="size-4" /> API
              </a>
              <ThemeToggle />
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <VerifyBanner />
            {children}
          </main>
        </div>
      </div>
    </RecentsProvider>
  );
}

function SidebarContent({ pathname, mobile }: { pathname: string; mobile?: boolean }) {
  const user = useUser();
  const hydrated = useHydrated();
  const hide = mobile ? "" : WHEN_COLLAPSED_HIDE;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5 in-data-[sidebar=collapsed]:lg:justify-center in-data-[sidebar=collapsed]:lg:px-0">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Bondeth AI home">
          <motion.span whileHover={{ rotate: -12 }} className="grid size-9 place-items-center rounded-xl bg-accent-soft">
            <MicDoodle className="h-7 w-6 text-ink" />
          </motion.span>
          <span className={cx("leading-tight", hide)}>
            <span className="block font-bold tracking-tight">Bondeth AI</span>
            <span className="khmer block text-[11px] leading-none text-ink-soft">បណ្ឌិត</span>
          </span>
        </Link>
      </div>

      <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <NavSection title="Create" items={WORKSPACES} pathname={pathname} hide={hide} />
        <NavSection title="Library" items={LIBRARY} pathname={pathname} hide={hide} locked={hydrated && !user} />
      </nav>

      <UsageMeter className={cx("mx-3 mb-3", hide)} />

      <div className={cx("mx-3 mb-3 overflow-hidden rounded-2xl border border-line bg-surface p-4", hide)}>
        <TwinVoicesDoodle className="h-14 w-28 text-ink" />
        <p className="mt-2 text-sm font-medium">Your voice, any words</p>
        <p className="text-xs text-ink-soft">Save a 3-30 s sample once, then clone it from any tool.</p>
        <Link href="/voices" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">Manage voices →</Link>
      </div>

      <div className="border-t border-line p-3">
        <div className={cx("flex items-center gap-2 transition-opacity", hydrated ? "opacity-100" : "opacity-0",
          "in-data-[sidebar=collapsed]:lg:flex-col")}>
          {user ? (
            <>
              <Link href="/account" title="Account" className="flex min-w-0 flex-1 items-center gap-2 rounded-xl hover:bg-surface-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lilac-soft text-sm font-bold uppercase text-lilac">
                  {(user.full_name || user.email)[0]}
                </span>
                <span className={cx("min-w-0 flex-1 leading-tight", hide)}>
                  <span className="block truncate text-sm font-medium">{user.full_name || "Signed in"}</span>
                  <span className="block truncate text-xs text-ink-soft">{user.email}</span>
                </span>
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-medium text-accent-ink">
              <LogIn className="size-4" /> <span className={hide}>Sign in</span>
            </Link>
          )}
          {!mobile && (
            <IconButton label="Collapse or expand sidebar" onClick={toggleSidebar}>
              <PanelLeftClose className="size-[18px] in-data-[sidebar=collapsed]:hidden" />
              <PanelLeftOpen className="hidden size-[18px] in-data-[sidebar=collapsed]:block" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

function SignOutButton() {
  const router = useRouter();
  return (
    <IconButton label="Sign out" onClick={() => { logout(); router.push("/"); }} className="hover:text-rose">
      <LogOut className="size-[18px]" />
    </IconButton>
  );
}

function NavSection({ title, items, pathname, hide, locked }: {
  title: string; items: NavItem[]; pathname: string; hide: string; locked?: boolean;
}) {
  return (
    <div>
      <p className={cx("mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint", hide)}>{title}</p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} title={item.label}
                className={cx("relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  "in-data-[sidebar=collapsed]:lg:justify-center",
                  active ? "text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink")}>
                {active && (
                  <motion.span layoutId="sidebar-active" className="absolute inset-0 rounded-xl bg-accent-soft"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
                <item.icon className={cx("relative size-[18px] shrink-0", active && "text-accent")} />
                <span className={cx("relative truncate", hide)}>{item.label}</span>
                {locked && <Lock className={cx("relative ml-auto size-3.5 text-ink-faint", hide)} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Shown until a signed-in user confirms their email (they only get the signed-out allowance until then). */
function VerifyBanner() {
  const user = useUser();
  const { resend, sending } = useResendVerification();
  if (user?.email_verified !== false) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-accent-soft px-4 py-3 text-sm">
      <MailWarning className="size-5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1">
        <strong>Confirm your email</strong> to unlock voice cloning, API keys and the full daily allowance.
        We sent a link to {user.email}.
      </p>
      <button type="button" onClick={() => resend(user.email)} disabled={sending}
        className="rounded-xl px-3 py-1.5 font-medium text-accent hover:bg-surface disabled:opacity-60">
        {sending ? "Sending…" : "Resend link"}
      </button>
    </div>
  );
}
