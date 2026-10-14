"use client";

import { motion, type SVGMotionProps, type Variants } from "motion/react";
import type { ReactNode } from "react";

/**
 * Building blocks for the hand-drawn illustrations.
 *
 * Lines use `currentColor` (the theme's ink) and fills use theme tokens, so every
 * doodle follows light/dark mode. Strokes "draw themselves" when they scroll into
 * view; `i` staggers the order. Motion's reduced-motion setting skips the animation.
 */

const drawVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number = 0) => ({
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { delay: i * 0.12, duration: 0.8, ease: "easeInOut" },
      opacity: { delay: i * 0.12, duration: 0.01 },
    },
  }),
};

const popVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  visible: (i: number = 0) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.12, type: "spring", stiffness: 260, damping: 18 },
  }),
};

type DoodleProps = {
  viewBox: string;
  className?: string;
  /** Accessible description; omit for purely decorative doodles. */
  label?: string;
  children: ReactNode;
} & Pick<SVGMotionProps<SVGSVGElement>, "x" | "y" | "width" | "height">;

export function Doodle({ viewBox, className, label, children, ...position }: DoodleProps) {
  return (
    <motion.svg
      viewBox={viewBox}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      overflow="visible"
      {...position}
    >
      {children}
    </motion.svg>
  );
}

/** A line that sketches itself in. */
export function Stroke({ i = 0, ...props }: SVGMotionProps<SVGPathElement> & { i?: number }) {
  return <motion.path variants={drawVariants} custom={i} {...props} />;
}

/** A filled shape (highlighter blob, dot, dashed outline) that pops in. */
export function Fill({ i = 0, ...props }: SVGMotionProps<SVGPathElement> & { i?: number }) {
  return <motion.path variants={popVariants} custom={i} style={{ transformBox: "fill-box", transformOrigin: "center" }} {...props} />;
}

/** Text inside a doodle (e.g. a Khmer letter in a speech bubble). */
export function DoodleText({ i = 0, children, ...props }: SVGMotionProps<SVGTextElement> & { i?: number }) {
  return (
    <motion.text
      variants={popVariants}
      custom={i}
      fill="currentColor"
      stroke="none"
      textAnchor="middle"
      dominantBaseline="central"
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      {...props}
    >
      {children}
    </motion.text>
  );
}

/** Gentle endless float, for doodles that should feel alive. */
export function Float({ children, delay = 0, distance = 6 }: { children: ReactNode; delay?: number; distance?: number }) {
  return (
    <motion.g
      animate={{ y: [0, -distance, 0] }}
      transition={{ duration: 4, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.g>
  );
}

/** Endless twinkle for sparkles. */
export function Twinkle({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.g
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      animate={{ scale: [1, 1.25, 1], rotate: [0, 15, 0] }}
      transition={{ duration: 2.4, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.g>
  );
}
