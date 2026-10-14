"use client";

import type { ComponentProps } from "react";

import { Doodle, DoodleText, Fill, Float, Stroke, Twinkle } from "./Doodle";

/** Doodles can be placed inside another doodle's SVG with x/y/width/height. */
type Props = { className?: string; label?: string } & Pick<ComponentProps<typeof Doodle>, "x" | "y" | "width" | "height">;

const SPARKLE = "M12 2 C12.8 8 16 11.2 22 12 C16 12.8 12.8 16 12 22 C11.2 16 8 12.8 2 12 C8 11.2 11.2 8 12 2 Z";

export function MicDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 120 150" className={className} {...pos} label={label}>
      <Fill fill="var(--accent-soft)" stroke="none"
        d="M20 62 C15 32 45 12 70 18 C100 24 110 56 99 82 C88 106 50 112 32 97 C22 88 22 74 20 62 Z" />
      <Stroke i={1} d="M44 27 C44 13 76 13 76 27 L77 68 C77 83 43 83 43 68 Z" fill="var(--surface)" />
      <Stroke i={2} d="M50 36 Q60 34.5 70 36.5" />
      <Stroke i={2.4} d="M49 46 Q60 44.5 71 46.5" />
      <Stroke i={2.8} d="M49 56 Q60 54.5 71 56.5" />
      <Stroke i={3} d="M31 60 C31 99 89 99 89 60" />
      <Stroke i={3.6} d="M60 91 L60 117" />
      <Stroke i={4} d="M41 121 Q60 114.5 79 121" />
      <Stroke i={4.4} d="M50 22 Q52.5 18.5 56.5 17.5" strokeWidth={2} stroke="var(--accent)" />
    </Doodle>
  );
}

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

export function SpeechBubbleDoodle({ className, label, text, fill = "var(--surface)", ...pos }: Props & { text: string; fill?: string }) {
  return (
    <Doodle viewBox="0 0 120 100" className={className} {...pos} label={label}>
      <Stroke fill={fill}
        d="M18 14 C40 6 86 6 104 16 C116 24 116 58 104 66 C92 74 70 74 56 72 L35 91 L40 70 C24 68 12 62 10 50 C8 36 8 20 18 14 Z" />
      {/* Longer words get a smaller size so they stay inside the bubble. */}
      <DoodleText i={4} x={60} y={40} fontSize={[...text].length > 6 ? 22 : 30} fontWeight={700} className="khmer">
        {text}
      </DoodleText>
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
    <Doodle viewBox="0 0 120 110" className={className} {...pos} label={label}>
      <Fill fill="var(--teal-soft)" stroke="none"
        d="M14 70 C10 40 40 22 66 26 C96 30 112 52 106 78 C100 100 62 106 40 100 C24 96 16 86 14 70 Z" />
      <Stroke i={1} d="M22 66 C18 24 102 24 98 66" />
      <Stroke i={2} d="M16 62 C10 64 10 92 18 94 L30 94 C34 94 34 62 30 62 Z" fill="var(--surface)" />
      <Stroke i={2.5} d="M104 62 C110 64 110 92 102 94 L90 94 C86 94 86 62 90 62 Z" fill="var(--surface)" />
      <Stroke i={3.5} d="M54 74 L54 56 L70 52 L70 70" stroke="var(--teal)" />
      <Fill i={4} d="M50 75 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0" fill="var(--teal)" stroke="none" />
      <Fill i={4.2} d="M66 71 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0" fill="var(--teal)" stroke="none" />
    </Doodle>
  );
}

const HEAD = "M50 20 C78 20 86 44 84 62 C82 86 66 100 48 100 C28 100 14 84 16 60 C18 38 30 20 50 20 Z";

export function TwinVoicesDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 210 120" className={className} {...pos} label={label}>
      <Fill fill="var(--lilac-soft)" stroke="none"
        d="M20 40 C40 4 170 0 196 40 C214 70 190 112 120 114 C50 116 4 80 20 40 Z" />
      <Stroke i={1} d={HEAD} fill="var(--surface)" />
      <Stroke i={2} d="M39 55 L39 58" strokeWidth={4.5} />
      <Stroke i={2.2} d="M58 55 L58 58" strokeWidth={4.5} />
      <Stroke i={2.6} d="M38 73 Q49 82 61 73" />
      <Stroke i={3.2} d="M98 47 Q106 60 98 73" stroke="var(--accent)" />
      <Stroke i={3.5} d="M110 39 Q123 60 110 81" stroke="var(--accent)" />
      {/* The clone: same face, dashed and in lilac. Dashed lines can't "draw", so they pop. */}
      <g transform="translate(112 0)">
        <Fill i={4.5} d={HEAD} fill="var(--surface)" stroke="var(--lilac)" strokeDasharray="7 7" />
        <Fill i={5} d="M39 55 L39 58" stroke="var(--lilac)" strokeWidth={4.5} />
        <Fill i={5} d="M58 55 L58 58" stroke="var(--lilac)" strokeWidth={4.5} />
        <Fill i={5.3} d="M38 73 Q49 82 61 73" stroke="var(--lilac)" />
      </g>
    </Doodle>
  );
}

export function NotebookDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 130 120" className={className} {...pos} label={label}>
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
      <Stroke i={4.6} d="M74 92 L70 104 L83 100" />
    </Doodle>
  );
}

export function PadlockDoodle({ className, label, ...pos }: Props) {
  return (
    <Doodle viewBox="0 0 120 120" className={className} {...pos} label={label}>
      <Fill fill="var(--lilac-soft)" stroke="none"
        d="M14 66 C10 36 40 16 66 20 C98 24 112 52 106 80 C100 106 60 114 38 104 C22 96 16 82 14 66 Z" />
      <Stroke i={1} d="M44 52 L44 36 C44 15 76 15 76 36 L76 52" />
      <Stroke i={2} d="M33 52 L87 51 L89 104 L31 105 Z" fill="var(--surface)" />
      <Fill i={3.5} d="M55 72 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0" fill="currentColor" stroke="none" />
      <Stroke i={3.8} d="M60 77 L60 89" />
    </Doodle>
  );
}

/** The landing-page scene: a microphone surrounded by bilingual speech. */
export function HeroScene({ className }: { className?: string }) {
  return (
    <Doodle viewBox="0 0 480 430" className={className}
      label="Doodle of a microphone with speech bubbles in Khmer and English">
      <Fill fill="var(--accent-soft)" stroke="none"
        d="M80 220 C60 120 160 50 260 60 C370 70 440 150 420 250 C400 350 290 400 190 380 C110 364 92 300 80 220 Z" />
      <Fill i={0.5} fill="var(--teal-soft)" stroke="none" d="M360 330 a38 34 0 1 0 76 0 a38 34 0 1 0 -76 0" />
      <Fill i={0.7} fill="var(--lilac-soft)" stroke="none" d="M40 90 a30 28 0 1 0 60 0 a30 28 0 1 0 -60 0" />

      <Float>
        <MicDoodle x={150} y={90} width={180} height={225} />
      </Float>
      <Float delay={0.6} distance={4}>
        <WavesDoodle x={325} y={160} width={60} height={80} />
      </Float>
      <Float delay={0.9} distance={4}>
        <g transform="translate(155 160) scale(-1 1)">
          <WavesDoodle x={0} y={0} width={60} height={80} />
        </g>
      </Float>

      <Float delay={0.3} distance={10}>
        <SpeechBubbleDoodle x={20} y={130} width={130} height={108} text="សួស្តី" />
      </Float>
      <Float delay={1.2} distance={8}>
        <SpeechBubbleDoodle x={330} y={40} width={120} height={100} text="Hi!" fill="var(--teal-soft)" />
      </Float>

      <Float delay={0.8} distance={12}>
        <g className="khmer" fontWeight={700}>
          <DoodleText i={6} x={95} y={330} fontSize={44} fill="var(--lilac)">ក</DoodleText>
          <DoodleText i={6.4} x={400} y={250} fontSize={36} fill="var(--accent)">ខ</DoodleText>
          <DoodleText i={6.8} x={350} y={405} fontSize={30} fill="var(--teal)">គ</DoodleText>
        </g>
      </Float>

      <Twinkle delay={0}><SparkleDoodle x={110} y={40} width={30} height={30} /></Twinkle>
      <Twinkle delay={0.8}><SparkleDoodle x={420} y={160} width={22} height={22} color="var(--lilac)" /></Twinkle>
      <Twinkle delay={1.6}><SparkleDoodle x={60} y={270} width={18} height={18} color="var(--teal)" /></Twinkle>
      <Twinkle delay={0.4}><SparkleDoodle x={250} y={20} width={20} height={20} /></Twinkle>

      <WaveformDoodle x={170} y={350} width={140} height={60} />
    </Doodle>
  );
}
