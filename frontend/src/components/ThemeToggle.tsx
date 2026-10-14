"use client";

import { Moon, Sun } from "lucide-react";
import { motion } from "motion/react";

import { cx } from "@/components/ui";
import { getTheme, setTheme } from "@/lib/theme";

/**
 * Which icon shows is decided by CSS from <html data-theme>, which is already set
 * before the first paint, so the toggle never flashes the wrong icon.
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <motion.button
      type="button"
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
      whileTap={{ scale: 0.88, rotate: -20 }}
      onClick={() => setTheme(getTheme() === "dark" ? "light" : "dark")}
      className={cx("relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink", className)}
    >
      <Sun className="absolute size-[18px] rotate-90 scale-0 transition-transform duration-500 dark:rotate-0 dark:scale-100" />
      <Moon className="absolute size-[18px] rotate-0 scale-100 transition-transform duration-500 dark:-rotate-90 dark:scale-0" />
    </motion.button>
  );
}
