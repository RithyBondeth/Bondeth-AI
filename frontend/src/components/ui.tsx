"use client";

import type { MessageValues } from "@/lib/i18n";
import { useT } from "@/lib/useLocale";

import { LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const spring = { type: "spring", stiffness: 500, damping: 32 } as const;

// ---------- Buttons ----------

const BUTTON_VARIANTS = {
  primary:
    "ink-button bg-accent text-accent-ink hover:brightness-105",
  secondary: "ink-button bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-soft hover:bg-surface-2 hover:text-ink",
  danger: "text-rose hover:bg-rose-soft",
};

type ButtonProps = HTMLMotionProps<"button"> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <motion.button
      transition={spring}
      disabled={inactive}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,filter,box-shadow,color]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-[1.1em] animate-spin" /> : icon}
      {children as ReactNode}
    </motion.button>
  );
}

export function IconButton({ label, className, children, ...rest }: HTMLMotionProps<"button"> & { label: string }) {
  const t = useT();
  return (
    <motion.button
      type="button"
      aria-label={t(label)}
      title={t(label)}
      whileTap={{ scale: 0.9 }}
      className={cx("grid size-9 shrink-0 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink", className)}
      {...rest}
    >
      {children as ReactNode}
    </motion.button>
  );
}

// ---------- Panels ----------

export function Panel({ className, children, ...rest }: HTMLMotionProps<"section">) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
      className={cx("paper-panel bg-surface", className)}
      {...rest}
    >
      {children}
    </motion.section>
  );
}

export function PanelHeader({ title, km, children }: { title: string; km?: string; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-t-[19px] border-b border-line bg-surface-2/30 px-5 py-2">
      <h2 className="text-sm font-bold">
        {t(title)} {km && <span className="secondary-khmer khmer font-normal text-ink-soft">· {km}</span>}
      </h2>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

/** A labelled block inside a settings panel. */
export function Setting({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs font-medium tracking-wide text-ink-soft">
        <span>{t(label)}</span>
        {value !== undefined && <span className="normal-case tabular-nums text-ink">{value}</span>}
      </div>
      {children}
    </div>
  );
}

// ---------- Form fields ----------

const FIELD =
  "ink-field w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:bg-surface focus:outline-none";

export function Field({ label, hint, hideLabel = false, children }: { label: string; hint?: ReactNode; hideLabel?: boolean; children: (id: string) => ReactNode }) {
  const t = useT();
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-sm font-medium text-ink"}>{t(label)}</label>
      {children(id)}
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export function Input({ className, onInvalid, onInput, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const t = useT();
  return <input className={cx(FIELD, className)} {...props}
    onInvalid={(event) => {
      const input = event.currentTarget;
      input.setCustomValidity("");
      if (input.validity.valueMissing) input.setCustomValidity(t("Please fill out this field."));
      else if (input.validity.typeMismatch && input.type === "email") input.setCustomValidity(t("Please enter a valid email address."));
      else if (input.validity.tooShort) input.setCustomValidity(t("Use at least {count} characters.", { count: input.minLength }));
      onInvalid?.(event);
    }}
    onInput={(event) => { event.currentTarget.setCustomValidity(""); onInput?.(event); }} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, "resize-y leading-relaxed", className)} {...props} />;
}

export function Slider({ value, onChange, min, max, step, label }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string;
}) {
  const t = useT();
  return (
    <input type="range" aria-label={t(label)} min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
  );
}

// ---------- Segmented control / tabs ----------

export function Segmented<T extends string>({ value, onChange, options, label, full, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  full?: boolean;
  className?: string;
}) {
  const t = useT();
  const group = useId();
  return (
    <div role="radiogroup" aria-label={t(label)}
      className={cx("inline-flex rounded-xl bg-surface-2 p-1", full && "flex w-full", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("relative flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? "text-ink" : "text-ink-soft hover:text-ink")}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${group}`} transition={spring}
              className="absolute inset-0 rounded-lg bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.12)]" />
          )}
          <span className="relative">{typeof o.label === "string" ? t(o.label) : o.label}</span>
        </button>
      ))}
    </div>
  );
}

export const LANGUAGE_OPTIONS: { value: "auto" | "km" | "en"; label: ReactNode }[] = [
  { value: "auto", label: "Auto" },
  { value: "km", label: <span className="khmer">ខ្មែរ</span> },
  { value: "en", label: "English" },
];

// ---------- Badge ----------

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "teal" | "lilac" | "rose" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-soft",
    accent: "bg-accent-soft text-ink",
    teal: "bg-teal-soft text-ink",
    lilac: "bg-lilac-soft text-ink",
    rose: "bg-rose-soft text-rose",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

// ---------- Empty state ----------

export function EmptyState({ doodle, title, children, action }: { doodle: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 rounded-3xl p-4">{doodle}</div>
      <h3 className="font-medium">{t(title)}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------- Dialog ----------

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div role="dialog" aria-modal aria-label={t(title)}
            initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto paper-panel bg-surface scroll-thin">
            <div className="sticky top-0 z-10 flex items-center border-b border-line bg-surface px-5 py-3">
              <h2 className="font-medium">{t(title)}</h2>
              <IconButton label={t("Close")} onClick={onClose} className="ml-auto"><X className="size-4" /></IconButton>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>, document.body
  );
}

// ---------- Toasts ----------

type Toast = { id: number; message: string; values?: MessageValues; tone: "info" | "error" | "success" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"], values?: MessageValues) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const translateMessage = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "info", values?: MessageValues) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone, values }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-4 right-4 z-[60] flex flex-col items-end gap-2 sm:bottom-5 sm:left-auto sm:right-5">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.95 }}
              className="pointer-events-auto flex w-full max-w-sm items-center gap-2.5 paper-panel bg-surface px-4 py-3 text-sm sm:w-auto"
            >
              <span className={cx("size-2 shrink-0 rounded-full",
                t.tone === "error" ? "bg-rose" : t.tone === "success" ? "bg-teal" : "bg-accent")} />
              <span className="min-w-0 break-words">{translateMessage(t.message, t.values)}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
