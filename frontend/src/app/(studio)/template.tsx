"use client";

import { motion } from "motion/react";

/** Re-mounts on every navigation inside the studio, so only the workspace animates, never the sidebar. */
export default function StudioTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 200, damping: 26 }}
    >
      {children}
    </motion.div>
  );
}
