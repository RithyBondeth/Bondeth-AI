"use client";

import { motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

import { Doodle, DoodleText, Fill, Float, Print, Stroke, useLoop } from "./Doodle";
import { BLUSH, Bust, Fist, Palm, Thumb } from "./people";

/** Doodles can be placed inside another doodle's SVG with x/y/width/height. */
type Props = { className?: string; label?: string } & Pick<ComponentProps<typeof Doodle>, "x" | "y" | "width" | "height" | "still">;

const SPARKLE = "M12 2 C12.8 8 16 11.2 22 12 C16 12.8 12.8 16 12 22 C11.2 16 8 12.8 2 12 C8 11.2 11.2 8 12 2 Z";

/** People scenes use a bolder ink line than the small object doodles. */
const INK = 3.5;

// ---------- Small objects (inline hints, decorations) ----------

export function WavesDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 60 80" className={className} {...pos} label={label}>
      <Stroke i={0} d="M10 26 Q19 40 10 54" stroke="var(--accent)" />
      <Stroke i={1} d="M24 15 Q39 40 24 65" stroke="var(--accent)" />
      <Stroke i={2} d="M38 5 Q59 40 38 75" stroke="var(--accent)" />
    </Doodle>
  );
}

export function SparkleDoodle({ className, color = "var(--accent)", ...pos }: Props & { color?: string }) {
  return (
    <Doodle viewBox="0 0 24 24" className={className} {...pos}>
      <Fill d={SPARKLE} fill={color} stroke="none" />
    </Doodle>
  );
}

export function SpeechBubbleDoodle({ className, label, text, fill = "var(--surface)", flip = false, ...pos }:
  Props & { text: string; fill?: string; flip?: boolean }) {
  return (
    <Doodle viewBox="0 0 120 100" className={className} {...pos} label={label} strokeWidth={3}>
      <Stroke fill={fill} transform={flip ? "translate(120 0) scale(-1 1)" : undefined}
        d="M18 14 C40 6 86 6 104 16 C116 24 116 58 104 66 C92 74 70 74 56 72 L35 91 L40 70 C24 68 12 62 10 50 C8 36 8 20 18 14 Z" />
      {/* Longer words get a smaller size so they stay inside the bubble. */}
      <DoodleText i={4} x={60} y={40} fontSize={[...text].length > 6 ? 22 : 28}>{text}</DoodleText>
    </Doodle>
  );
}

export function SquiggleUnderline({ className, color = "var(--accent)", ...pos }: Props & { color?: string }) {
  return (
    <Doodle viewBox="0 0 200 20" className={className} {...pos}>
      <Stroke d="M3 12 C23 4 43 18 63 10 S103 4 123 11 S163 17 197 8" stroke={color} strokeWidth={5} />
    </Doodle>
  );
}

export function CurlyArrowDoodle({ className, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 100 80" className={className} {...pos}>
      <Stroke d="M8 12 C30 4 60 10 58 34 C56 52 32 52 36 36 C40 20 70 30 84 58" />
      <Stroke i={6} d="M71 55 L85 60 L87 46" />
    </Doodle>
  );
}

const BARS = [12, 28, 18, 40, 24, 50, 30, 44, 20, 36, 16, 26, 10];

export function WaveformDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 140 60" className={className} {...pos} label={label}>
      {BARS.map((h, k) => (
        <Stroke key={k} i={k * 0.25} d={`M${10 + k * 10} ${30 - h / 2} L${10 + k * 10} ${30 + h / 2}`}
          stroke={k % 3 === 1 ? "var(--accent)" : "currentColor"} strokeWidth={4} />
      ))}
    </Doodle>
  );
}

export function HeadphonesDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 120 110" className={className} {...pos} label={label} strokeWidth={3}>
      <Fill fill="var(--teal-soft)" stroke="none"
        d="M14 70 C10 40 40 22 66 26 C96 30 112 52 106 78 C100 100 62 106 40 100 C24 96 16 86 14 70 Z" />
      <Stroke i={1} d="M22 66 C18 24 102 24 98 66" strokeWidth={5} />
      <Stroke i={2} d="M16 62 C10 64 10 92 18 94 L30 94 C34 94 34 62 30 62 Z" fill="var(--teal)" />
      <Stroke i={2.5} d="M104 62 C110 64 110 92 102 94 L90 94 C86 94 86 62 90 62 Z" fill="var(--teal)" />
      <Stroke i={3.5} d="M54 74 L54 56 L70 52 L70 70" />
      <Fill i={4} d="M50 75 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0" fill="currentColor" stroke="none" />
      <Fill i={4.2} d="M66 71 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0" fill="currentColor" stroke="none" />
    </Doodle>
  );
}

/** A spiral notebook and pencil: used where something is being written up. */
export function NotebookDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 130 120" className={className} {...pos} label={label} strokeWidth={3}>
      <Fill fill="var(--accent-soft)" stroke="none"
        d="M10 60 C8 24 50 6 84 12 C116 18 126 52 118 80 C110 108 60 116 34 104 C18 96 11 80 10 60 Z" />
      <Stroke i={1} d="M30 20 L90 17 L93 101 L33 104 Z" fill="var(--surface)" />
      <Stroke i={2} d="M44 40 L80 38" />
      <Stroke i={2.3} d="M44 54 L80 52" />
      <Stroke i={2.6} d="M44 68 L70 67" />
      {[30, 50, 70, 90].map((y, k) => (
        <Stroke key={y} i={3 + k * 0.2} d={`M26 ${y} a4 4 0 1 0 8 0`} />
      ))}
      <Stroke i={4} d="M74 92 L106 58 L115 66 L83 100 Z" fill="var(--accent)" />
      <Stroke i={4.6} d="M74 92 L70 104 L83 100" fill="var(--surface)" />
    </Doodle>
  );
}

// ---------- People ----------

const BLOB = "M40 120 C34 60 96 24 160 28 C232 32 276 80 266 132 C256 186 190 208 130 204 C76 200 44 170 40 120 Z";

function Sparkle({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return (
    // Position on a wrapper: the pop-in scale replaces any transform on the path itself.
    <g transform={`translate(${x} ${y}) scale(${size / 24})`}>
      <Fill i={5} d={SPARKLE} fill={color} stroke="none" />
    </g>
  );
}

/** A hand that waves, pivoting at the wrist, while its doodle is on screen. */
function Wave({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const loop = useLoop();
  return (
    <motion.g style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
      animate={loop ? { rotate: [0, 12, -6, 12, 0, 0] } : { rotate: 0 }}
      transition={loop
        ? { duration: 2.4, delay, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut", times: [0, 0.15, 0.3, 0.45, 0.6, 1] }
        : { duration: 0.4 }}>
      {children}
    </motion.g>
  );
}

/** Someone talking into a microphone; their words land on a transcript card. (Speech to Text) */
export function SpeakerDoodle({ className, label, still, ...pos }: Props) {
  return (
    <Doodle viewBox="20 20 270 195" className={className} {...pos} label={label} strokeWidth={INK} still={still}>
      <Fill fill="var(--accent-soft)" stroke="none" d={BLOB} />
      <g transform="translate(40 70)">
        <Bust top="var(--accent)" print="stripes" hair="long" face="talk" i={1} />
        <Stroke i={2} d="M86 132 C88 118 94 106 100 98 L118 104 C112 112 108 122 108 132 Z" fill="var(--accent)" />
        <Stroke i={2.3} d="M100 98 L118 104" strokeWidth={3} />
        <Stroke i={2.6} d="M106 90 L96 70" strokeWidth={7} />
        <Stroke i={2.8} d="M83 63 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0" fill="var(--teal)" />
        <Stroke i={3} d="M86 60 L98 56 M88 66 L100 62" strokeWidth={2} />
        <Fist x={108} y={92} rotate={-62} i={3} />
      </g>
      <g transform="translate(178 60) rotate(4)">
          <Stroke i={3.5} d="M10 0 L76 0 Q86 0 86 10 L86 94 Q86 104 76 104 L10 104 Q0 104 0 94 L0 10 Q0 0 10 0 Z" fill="var(--surface)" />
          <DoodleText i={4.5} x={43} y={30} fontSize={20}>សួស្តី</DoodleText>
          <Stroke i={4.6} d="M14 56 L72 56" strokeWidth={3} />
          <Stroke i={4.8} d="M14 70 L64 70" strokeWidth={3} />
          <Stroke i={5} d="M14 84 L52 84" strokeWidth={3} stroke="var(--accent)" />
        </g>
      <Fill i={4} d="M152 108 Q160 96 172 94" stroke="var(--accent)" strokeDasharray="4 7" />
      <Sparkle x={250} y={34} size={20} color="var(--lilac)" />
    </Doodle>
  );
}

const LEGS = "M-34 152 C-28 128 36 122 60 138 C84 122 148 128 154 152 C158 170 122 176 60 172 C-2 176 -38 170 -34 152 Z";

/** Someone sitting cross-legged with headphones on, eyes closed, enjoying the audio. (Text to Speech) */
export function ListenerDoodle({ className, label, still, ...pos }: Props) {
  return (
    <Doodle viewBox="20 20 270 230" className={className} {...pos} label={label} strokeWidth={INK} still={still}>
      <Fill fill="var(--teal-soft)" stroke="none"
        d="M40 150 C30 80 90 30 160 34 C236 38 278 96 266 156 C254 214 186 244 120 236 C70 230 46 196 40 150 Z" />
      <Stroke i={0.5} d="M54 230 a96 16 0 1 0 192 0 a96 16 0 1 0 -192 0" fill="var(--teal)" />
      <g transform="translate(90 64)">
        <Stroke i={1} d={LEGS} fill="var(--surface)" />
        <Print i={1.6} d={LEGS} name="spots" />
        <Stroke i={1.8} d={LEGS} />
        <Stroke i={2} fill="var(--skin)"
          d="M36 160 C44 152 58 154 58 162 C58 168 44 170 36 166 Z M84 160 C76 152 62 154 62 162 C62 168 76 170 84 166 Z" />
        <Bust top="var(--accent)" hair="bun" face="closed" i={2} />
        <Stroke i={3} d="M26 96 C12 110 2 126 -4 140 L14 146 C18 134 26 122 34 112" fill="var(--accent)" />
        <Stroke i={3} d="M94 96 C108 110 118 126 124 140 L106 146 C102 134 94 122 86 112" fill="var(--accent)" />
        <Stroke i={3.4} d="M-4 140 L14 146 M124 140 L106 146" strokeWidth={3} />
        <Stroke i={3.6} fill="var(--skin)"
          d="M-8 144 C-6 138 14 140 16 148 C17 154 8 158 0 156 C-6 154 -10 150 -8 144 Z M128 144 C126 138 106 140 104 148 C103 154 112 158 120 156 C126 154 130 150 128 144 Z" />
        <Stroke i={3.8} d="M2 150 L8 152 M118 150 L112 152" strokeWidth={2} />
        <Stroke i={4} d="M30 50 C26 4 94 4 90 50" strokeWidth={6} />
        <Stroke i={4.4} d="M29 40 L31 40 Q38 40 38 47 L38 59 Q38 66 31 66 L29 66 Q22 66 22 59 L22 47 Q22 40 29 40 Z" fill="var(--teal)" />
        <Stroke i={4.4} d="M89 40 L91 40 Q98 40 98 47 L98 59 Q98 66 91 66 L89 66 Q82 66 82 59 L82 47 Q82 40 89 40 Z" fill="var(--teal)" />
      </g>
      <Stroke i={5} d="M226 74 L226 44 L246 40 L246 66" />
      <Fill i={5.2} d="M217 76 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M237 68 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0" fill="currentColor" stroke="none" />
      <Stroke i={5.4} d="M60 70 L60 48 Q70 50 70 60" />
      <Fill i={5.6} d="M51 72 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0" fill="currentColor" stroke="none" />
      <Sparkle x={250} y={120} size={18} color="var(--accent)" />
      <Sparkle x={40} y={120} size={14} color="var(--lilac)" />
    </Doodle>
  );
}

/** A person and their dashed voice clone, waving at each other. (Voice Clone) */
export function TwinVoicesDoodle({ className, label, still, ...pos }: Props) {
  return (
    <Doodle viewBox="0 8 300 186" className={className} {...pos} label={label} strokeWidth={INK} still={still}>
      <Fill fill="var(--lilac-soft)" stroke="none"
        d="M30 110 C30 50 100 20 160 24 C230 28 280 70 272 122 C264 172 200 192 140 188 C76 184 30 160 30 110 Z" />
      <g transform="translate(20 50)">
        <Bust top="var(--lilac)" print="dots" hair="short" face="talk" i={1} />
        <Stroke i={2.5} d="M30 100 C20 92 10 80 4 66 L-12 72 C-6 88 6 106 22 118" fill="var(--lilac)" />
        <Stroke i={2.8} d="M4 66 L-12 72" strokeWidth={3} />
        <Wave><Palm x={-5} y={68} rotate={-18} scale={0.9} i={3} /></Wave>
      </g>
      <g transform="translate(160 50)">
        <Bust hair="short" face="smile" dashed i={3.5} />
        <g transform="translate(120 0) scale(-1 1)">
          <Fill i={4.5} d="M30 100 C20 92 10 80 4 66 L-12 72 C-6 88 6 106 22 118"
            fill="var(--surface)" stroke="var(--lilac)" strokeDasharray="6 7" />
          <Wave delay={0.3}><Palm x={-5} y={68} rotate={-18} scale={0.9} i={4.8} dashed /></Wave>
        </g>
      </g>
      <Stroke i={4} d="M138 92 Q146 104 138 116" stroke="var(--accent)" />
      <Stroke i={4.3} d="M150 84 Q162 104 150 124" stroke="var(--accent)" />
      <Sparkle x={250} y={22} size={20} color="var(--lilac)" />
      <Sparkle x={140} y={30} size={14} color="var(--accent)" />
    </Doodle>
  );
}

/** Someone reading an open notebook of transcripts. (History) */
export function ReaderDoodle({ className, label, still, ...pos }: Props) {
  return (
    <Doodle viewBox="30 20 250 190" className={className} {...pos} label={label} strokeWidth={INK} still={still}>
      <Fill fill="var(--accent-soft)" stroke="none" d={BLOB} />
      <g transform="translate(90 62)">
        <Bust top="var(--teal)" print="spots" hair="long" face="smile" i={1} />
        <Stroke i={2} d="M24 100 C12 112 2 130 0 150 L18 152 C20 136 26 122 34 112" fill="var(--teal)" />
        <Stroke i={2} d="M96 100 C108 112 118 130 120 150 L102 152 C100 136 94 122 86 112" fill="var(--teal)" />
        <Stroke i={2.5} d="M60 98 C40 88 14 90 -6 98 L-2 160 C18 152 42 152 60 162 Z" fill="var(--surface)" />
        <Stroke i={2.5} d="M60 98 C80 88 106 90 126 98 L122 160 C102 152 78 152 60 162 Z" fill="var(--surface)" />
        <Stroke i={3.2} d="M8 112 C22 108 36 108 48 112" strokeWidth={2.5} />
        <Stroke i={3.4} d="M8 124 C22 120 36 120 48 124" strokeWidth={2.5} />
        <Stroke i={3.6} d="M10 136 C22 132 34 132 44 136" strokeWidth={2.5} />
        <DoodleText i={4} x={92} y={126} fontSize={28} fill="var(--accent)">ក</DoodleText>
        <Thumb x={2} y={146} rotate={-15} i={3.8} />
        <Thumb x={118} y={146} rotate={15} i={3.8} />
      </g>
      <g transform="translate(232 70) rotate(30)">
          <Stroke i={4.5} d="M-6 -34 L6 -34 L6 26 L-6 26 Z" fill="var(--accent)" />
          <Stroke i={4.7} d="M-6 26 L0 40 L6 26 Z" fill="var(--surface)" />
          <Stroke i={4.9} d="M-6 -42 L6 -42 L6 -34 L-6 -34 Z" fill="var(--rose)" />
        </g>
      <Sparkle x={48} y={44} size={20} color="var(--teal)" />
    </Doodle>
  );
}

/** Someone turning a big key in a padlock. (Sign in, API keys) */
export function UnlockDoodle({ className, label, still, ...pos }: Props) {
  return (
    <Doodle viewBox="30 20 250 190" className={className} {...pos} label={label} strokeWidth={INK} still={still}>
      <Fill fill="var(--lilac-soft)" stroke="none" d={BLOB} />
      <g transform="translate(40 70)">
        <Bust top="var(--rose)" print="triangles" hair="bun" face="smile" i={1} />
        <Stroke i={2} d="M90 96 C104 90 118 80 126 70 L138 82 C130 94 114 106 98 112" fill="var(--rose)" />
        <Stroke i={2.3} d="M126 70 L138 82" strokeWidth={3} />
        <Stroke i={3} d="M150 74 L192 74 M178 74 L178 84 M186 74 L186 82" strokeWidth={6} />
        <Stroke i={2.8} d="M135 74 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0" fill="var(--accent)" />
        <Fist x={140} y={76} i={3.2} />
      </g>
      <g transform="translate(240 96)">
        <Stroke i={3.5} d="M-16 20 L-16 2 C-16 -22 16 -22 16 2 L16 20" strokeWidth={5} />
        <Stroke i={3.8} d="M-21 18 L21 18 Q30 18 30 27 L30 63 Q30 72 21 72 L-21 72 Q-30 72 -30 63 L-30 27 Q-30 18 -21 18 Z" fill="var(--surface)" />
        <Fill i={4.4} d="M-6 42 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0" fill="currentColor" stroke="none" />
        <Stroke i={4.6} d="M0 46 L0 58" strokeWidth={4} />
      </g>
      <Sparkle x={256} y={44} size={18} color="var(--accent)" />
      <Sparkle x={46} y={60} size={14} color="var(--lilac)" />
    </Doodle>
  );
}

// ---------- Landing page ----------

function LetterTile({ x, y, letter, color, rotate, i }: { x: number; y: number; letter: string; color: string; rotate: number; i: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <Stroke i={i} d="M-10 -20 L10 -20 Q20 -20 20 -10 L20 10 Q20 20 10 20 L-10 20 Q-20 20 -20 10 L-20 -10 Q-20 -20 -10 -20 Z"
        fill="var(--surface)" strokeWidth={3} />
      <DoodleText i={i + 0.5} x={0} y={1} fontSize={24} fill={color}>{letter}</DoodleText>
    </g>
  );
}

const TROUSERS = "M176 268 L248 268 L262 376 L232 380 L214 302 L204 382 L172 382 Z";

/** The landing-page scene: someone greeting the world in Khmer and English. */
export function HeroScene({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 480 430" className={className} strokeWidth={INK}
      label="Doodle of a woman speaking into a microphone and waving, with speech bubbles in Khmer and English">
      <Fill fill="var(--accent-soft)" stroke="none"
        d="M90 230 C70 130 160 50 260 56 C370 64 446 150 424 250 C402 352 290 404 190 384 C112 368 104 300 90 230 Z" />
      <Fill i={0.5} fill="var(--teal-soft)" stroke="none" d="M370 356 a34 34 0 1 0 68 0 a34 34 0 1 0 -68 0" />
      <Fill i={0.7} fill="var(--lilac-soft)" stroke="none" d="M44 90 a26 26 0 1 0 52 0 a26 26 0 1 0 -52 0" />
      <Stroke i={0.5} d="M110 404 L370 404" strokeWidth={3} />

      <g transform="translate(-12 4)">
        <Fill i={1} fill="var(--hair)" stroke="currentColor"
          d="M182 112 C170 140 168 178 176 205 C190 214 230 214 246 204 C252 176 250 136 238 110 Z" />
        <Stroke i={1} d={TROUSERS} fill="var(--surface)" />
        <Print i={1.8} d={TROUSERS} name="triangles" />
        <Stroke i={2} d={TROUSERS} />
        <Stroke i={2} d="M172 380 L204 380 L206 398 L160 399 C152 398 156 388 172 380 Z" fill="var(--hair)" />
        <Stroke i={2} d="M232 378 L262 374 C276 382 280 394 272 397 L232 397 Z" fill="var(--hair)" />
        <Stroke i={1.5} d="M203 148 L203 170 L219 170 L219 148" fill="var(--skin)" />
        <Stroke i={1.5} fill="var(--accent)"
          d="M172 178 C182 166 196 164 204 164 C210 172 214 172 220 164 C230 164 244 168 252 180 C256 210 254 244 250 272 C228 280 196 280 172 272 C168 240 168 206 172 178 Z" />
        <Stroke i={2.5} d="M175 260 C198 267 228 267 250 260" strokeWidth={2.5} />

        {/* Waving arm: shoulder, elbow out, forearm up. */}
        <Stroke i={2.5} fill="var(--accent)"
          d="M249 176 C262 198 276 218 292 216 C306 214 312 196 312 176 L294 172 C294 186 292 196 288 196 C280 196 268 180 256 166" />
        <Stroke i={2.8} d="M294 174 L312 176" strokeWidth={3} />
        <Wave delay={1.5}><Palm x={303} y={176} rotate={8} scale={1.15} i={3} /></Wave>

        {/* Head */}
        <Stroke i={2} fill="var(--skin)"
          d="M211 92 C234 92 242 112 240 132 C238 152 226 160 212 160 C196 160 184 150 183 130 C182 110 192 92 211 92 Z" />
        <Fill i={2.4} fill="var(--hair)" stroke="currentColor"
          d="M184 124 C182 100 200 86 216 88 C232 90 244 102 240 126 C230 118 218 106 214 98 C208 110 196 120 184 124 Z" />
        <Fill i={2.6} d="M230 102 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0" fill="var(--rose)" stroke="currentColor" strokeWidth={2.5} />
        <Stroke i={3} d="M201 127 L201 131 M223 127 L223 131" stroke="var(--face)" strokeWidth={4.5} />
        <Fill i={3.1} d="M191 140 a5 3 0 1 0 10 0 a5 3 0 1 0 -10 0 M224 140 a5 3 0 1 0 10 0 a5 3 0 1 0 -10 0" fill={BLUSH} stroke="none" />
        <Fill i={3.2} d="M207 144 C209 152 217 152 219 144 Z" fill="var(--face)" stroke="var(--face)" strokeWidth={2.5} />

        {/* Mic arm, drawn over the chin: shoulder, elbow down, forearm up. */}
        <Stroke i={3} fill="var(--accent)"
          d="M176 180 C158 198 148 228 158 242 C168 254 188 236 200 210 L184 200 C178 214 172 224 168 222 C166 216 174 202 184 188" />
        <Stroke i={3.2} d="M184 200 L200 210" strokeWidth={3} />
        <Stroke i={3.4} d="M195 196 L200 174" strokeWidth={7} />
        <Stroke i={3.6} d="M190 166 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0" fill="var(--teal)" />
        <Stroke i={3.8} d="M193 161 L207 168 M195 157 L209 164" strokeWidth={2} />
        <Fist x={194} y={196} rotate={-70} scale={1.05} i={3.6} />

        <Stroke i={4} d="M250 128 Q258 136 250 146" stroke="var(--accent)" />
        <Stroke i={4.3} d="M260 120 Q272 136 260 154" stroke="var(--accent)" />
      </g>

      <Float delay={0.3} distance={8}>
        <SpeechBubbleDoodle x={282} y={50} width={130} height={108} text="សួស្តី" />
      </Float>
      <Float delay={1.2} distance={6}>
        <SpeechBubbleDoodle x={40} y={124} width={104} height={87} text="Hi!" fill="var(--teal-soft)" flip />
      </Float>

      <LetterTile x={384} y={232} letter="ក" color="var(--lilac)" rotate={10} i={5} />
      <LetterTile x={92} y={300} letter="ខ" color="var(--accent)" rotate={-12} i={5.3} />
      <LetterTile x={330} y={330} letter="គ" color="var(--teal)" rotate={6} i={5.6} />

      <Sparkle x={150} y={48} size={28} color="var(--accent)" />
      <Sparkle x={424} y={146} size={22} color="var(--lilac)" />
      <Sparkle x={52} y={226} size={18} color="var(--teal)" />
    </Doodle>
  );
}
