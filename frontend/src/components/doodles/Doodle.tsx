"use client";

import { motion, useInView, useReducedMotion, type SVGMotionProps, type Variants } from "motion/react";
import { createContext, useContext, useId, useRef, type ReactNode } from "react";

/**
 * Building blocks for the hand-drawn illustrations.
 *
 * Lines use `currentColor` (the theme's ink) and fills use theme tokens, so every
 * doodle follows light/dark mode. Strokes "draw themselves" when they scroll into
 * view; `i` staggers the order. With the OS "reduce motion" setting on, doodles appear
 * fully drawn and never loop. Loops (Float, useLoop) only run while the doodle is on screen.
 */

/** Fabric prints for clothes. Each doodle gets its own ids so several can share a page. */
export type PatternName = "triangles" | "spots" | "stripes" | "dots" | "hatch";

const PatternPrefix = createContext("doodle");

/** `fill` value for one of the fabric prints, e.g. `fill={usePattern("spots")}`. */
export function usePattern(name: PatternName) {
  return `url(#${useContext(PatternPrefix)}-${name})`;
}

function Patterns({ prefix }: { prefix: string }) {
  return (
    <defs>
      <pattern id={`${prefix}-triangles`} width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
        <path d="M4 16 L10 5 L16 16 Z" strokeWidth={2.2} />
      </pattern>
      <pattern id={`${prefix}-spots`} width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
        <path d="M5 6 C8 3 12 6 10 9 C8 12 3 10 5 6 Z M15 16 C18 14 21 17 19 20 C17 22 13 19 15 16 Z" fill="currentColor" stroke="none" />
      </pattern>
      <pattern id={`${prefix}-stripes`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
        <path d="M0 7 L14 7" strokeWidth={2.2} />
      </pattern>
      <pattern id={`${prefix}-dots`} width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="2" fill="currentColor" stroke="none" />
        <circle cx="11" cy="11" r="2" fill="currentColor" stroke="none" />
      </pattern>
      <pattern id={`${prefix}-hatch`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 4.5 L9 4.5" stroke="var(--lilac)" strokeWidth={2} />
      </pattern>
    </defs>
  );
}

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
  /** Line weight in viewBox units. People scenes use a bolder ink line. */
  strokeWidth?: number;
  /** Never loop, e.g. for doodles that sit on screen the whole time (sidebar). */
  still?: boolean;
  children: ReactNode;
} & Pick<SVGMotionProps<SVGSVGElement>, "x" | "y" | "width" | "height">;

/** Whether looping animations inside the current doodle should run right now. */
const Looping = createContext(false);
/** True inside a doodle, so a doodle placed in another follows its parent's looping. */
const Nested = createContext(false);

export function useLoop() {
  return useContext(Looping);
}

export function Doodle({ viewBox, className, label, strokeWidth = 2.5, still = false, children, ...position }: DoodleProps) {
  const prefix = `doodle${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { amount: 0.1 });
  // A doodle nested in another only loops when its parent does.
  const parentLoops = useContext(Looping);
  const nested = useContext(Nested);
  const loops = !reduce && !still && inView && (!nested || parentLoops);

  return (
    <motion.svg
      ref={ref}
      viewBox={viewBox}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(reduce
        ? { initial: "visible", animate: "visible" }
        : { initial: "hidden", whileInView: "visible", viewport: { once: true, amount: 0.3 } })}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      overflow="visible"
      {...position}
    >
      <Patterns prefix={prefix} />
      <Nested.Provider value>
        <Looping.Provider value={loops}>
          <PatternPrefix.Provider value={prefix}>{children}</PatternPrefix.Provider>
        </Looping.Provider>
      </Nested.Provider>
    </motion.svg>
  );
}

/** A line that sketches itself in. */
export function Stroke({ i = 0, className, ...props }: SVGMotionProps<SVGPathElement> & { i?: number }) {
  // `doodle-stroke` lets globals.css show the finished line under reduced motion (see the note there).
  return <motion.path variants={drawVariants} custom={i} className={className ? `doodle-stroke ${className}` : "doodle-stroke"} {...props} />;
}

/** A filled shape (highlighter blob, dot, dashed outline) that pops in. */
export function Fill({ i = 0, ...props }: SVGMotionProps<SVGPathElement> & { i?: number }) {
  return <motion.path variants={popVariants} custom={i} style={{ transformBox: "fill-box", transformOrigin: "center" }} {...props} />;
}

/** A fabric print laid over a shape (draw the shape's outline again on top). */
export function Print({ name, i = 0, d }: { name: PatternName; i?: number; d: string }) {
  return <Fill i={i} d={d} fill={usePattern(name)} stroke="none" />;
}

const KHMER =/[\u1780-\u17FF]/;

/**
 * Text inside a doodle (e.g. a Khmer letter in a speech bubble). The brand fonts are
 * set explicitly, so the face never falls back: Kantumruy Pro for Khmer, Ubuntu for Latin.
 */
export function DoodleText({ i = 0, children, className, ...props }: SVGMotionProps<SVGTextElement> & { i?: number; children: string }) {
  const font = KHMER.test(children) ? "font-khmer" : "font-sans";
  return (
    <motion.text
      variants={popVariants}
      custom={i}
      fill="currentColor"
      stroke="none"
      textAnchor="middle"
      dominantBaseline="central"
      fontWeight={700}
      className={className ? `${font} ${className}` : font}
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      {...props}
    >
      {children}
    </motion.text>
  );
}

/** Gentle float, for doodles that should feel alive. Pauses off screen and with reduced motion. */
export function Float({ children, delay = 0, distance = 6 }: { children: ReactNode; delay?: number; distance?: number }) {
  const loop = useLoop();
  return (
    <motion.g
      animate={loop ? { y: [0, -distance, 0] } : { y: 0 }}
      transition={loop ? { duration: 4, delay, repeat: Infinity, ease: "easeInOut" } : { duration: 0.6 }}
    >
      {children}
    </motion.g>
  );
}
