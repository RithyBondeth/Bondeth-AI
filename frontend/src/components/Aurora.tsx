"use client";

import { motion } from "motion/react";

/** Soft, slowly drifting colour glows behind the app. Purely decorative. */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -top-40 right-[-10%] size-[640px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, var(--glow-1), transparent 65%)" }}
        animate={{ x: [0, -60, 0], y: [0, 40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[-20%] left-[10%] size-[560px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, var(--glow-2), transparent 65%)" }}
        animate={{ x: [0, 80, 0], y: [0, -30, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
