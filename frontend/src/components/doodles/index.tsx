"use client";

import { useT } from "@/lib/useLocale";

import Image from "next/image";
import type { ComponentProps } from "react";

import { Doodle, DoodleText, Fill, Stroke } from "./Doodle";

type Props = { className?: string; label?: string; preload?: boolean } & Pick<ComponentProps<typeof Doodle>, "x" | "y" | "width" | "height" | "still">;
const INK = 1.8;
const PAPER = "var(--art-paper)";
const ORANGE = "var(--art-orange)";
const SPARKLE = "M12 2 Q13 11 22 12 Q13 13 12 22 Q11 13 2 12 Q11 11 12 2 Z";

/** Hand-drawn scenes share one ink-and-saffron style and use responsive image sizes. */
function Illustration({ name, className, label, hero = false, preload = false, sizes, loading }: Props & {
  name: string; hero?: boolean; sizes?: string; loading?: "lazy" | "eager";
}) {
  const t = useT();
  return <Image src={`/illustrations/${name}.png`} alt={label ? t(label) : ""}
    width={1448} height={1086} preload={hero || preload} loading={loading}
    sizes={sizes ?? (hero ? "(max-width: 1023px) 90vw, 540px" : "(max-width: 767px) 80vw, 384px")}
    className={`illustration-art object-contain ${className ?? ""}`} />;
}

export function WavesDoodle(props: Props) {
  return <Doodle viewBox="0 0 60 80" {...props} strokeWidth={2.8}>
    <Stroke d="M10 28 Q20 40 10 52 M25 17 Q42 40 25 63 M40 7 Q62 40 40 73" stroke={ORANGE} />
  </Doodle>;
}

export function SparkleDoodle({ color = "var(--accent)", ...props }: Props & { color?: string }) {
  return <Doodle viewBox="0 0 24 24" {...props}><Fill d={SPARKLE} fill={color} stroke="none" /></Doodle>;
}

export function SpeechBubbleDoodle({ text, fill = PAPER, flip = false, ...props }: Props & { text: string; fill?: string; flip?: boolean }) {
  return <Doodle viewBox="0 0 120 100" {...props} strokeWidth={INK}>
    <Stroke fill={fill} transform={flip ? "translate(120 0) scale(-1 1)" : undefined}
      d="M25 12 H95 Q110 12 110 27 V56 Q110 71 95 71 H53 L32 89 L36 71 H25 Q10 71 10 56 V27 Q10 12 25 12 Z" />
    <DoodleText i={1.2} x={60} y={41} fontSize={[...text].length > 6 ? 20 : 25}>{text}</DoodleText>
  </Doodle>;
}

export function SquiggleUnderline({ color = "var(--accent)", ...props }: Props & { color?: string }) {
  return <Doodle viewBox="0 0 200 20" {...props}>
    <Stroke d="M4 12 Q82 1 196 9 M28 17 Q108 8 172 13" stroke={color} strokeWidth={2.4} />
  </Doodle>;
}

export function CurlyArrowDoodle(props: Props) {
  return <Doodle viewBox="0 0 100 80" {...props} strokeWidth={1.8}>
    <Stroke d="M9 17 C39 5 66 18 59 37 C52 55 30 46 39 32 C49 18 76 35 83 60 M69 55 L84 62 L88 47" />
  </Doodle>;
}

function AudioBars({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    {[10, 20, 32, 17, 40, 26, 14, 30, 20, 10].map((height, n) =>
      <Stroke key={n} i={n * 0.06} d={`M${n * 7} ${-height / 2} v${height}`} stroke={color} strokeWidth={3.5} />)}
  </g>;
}

export function WaveformDoodle(props: Props) {
  return <Doodle viewBox="0 0 140 60" {...props}>
    <Stroke d="M5 30 H135" stroke="var(--art-rule)" strokeWidth={1} />
    <AudioBars x={15} y={30} scale={1.4} color={ORANGE} />
  </Doodle>;
}

export function HeadphonesDoodle(props: Props) {
  return <Doodle viewBox="0 0 120 110" {...props} strokeWidth={2.3}>
    <Fill d="M12 58 A48 44 0 1 0 108 58 A48 44 0 1 0 12 58" fill="var(--accent-soft)" stroke="none" />
    <Stroke i={0.4} d="M26 65 V49 A34 34 0 0 1 94 49 V65" strokeWidth={6} />
    <Stroke i={0.5} d="M31 40 A29 29 0 0 1 89 40" stroke={PAPER} strokeWidth={2} />
    <Stroke i={0.8} d="M24 58 Q18 58 18 65 V82 Q18 89 25 89 H34 V58 Z M96 58 Q102 58 102 65 V82 Q102 89 95 89 H86 V58 Z" fill={ORANGE} />
    <Stroke i={1} d="M34 60 V87 M86 60 V87" stroke={PAPER} />
    <Stroke i={1.2} d="M54 74 V52 L70 48 V68" />
    <Fill i={1.3} d="M46 74 a4 3 0 1 0 8 0 a4 3 0 1 0 -8 0 M62 68 a4 3 0 1 0 8 0 a4 3 0 1 0 -8 0" fill="currentColor" stroke="none" />
  </Doodle>;
}

export function NotebookDoodle(props: Props) {
  return <Illustration {...props} name="notebook-doodle-v2" />;
}

export function SpeakerDoodle(props: Props) {
  return <Illustration {...props} name="voice-studio-doodle-v2" />;
}

export function ListenerDoodle(props: Props) {
  return <Illustration {...props} name="listener-doodle-v2" />;
}

export function TwinVoicesDoodle(props: Props & { loading?: "lazy" | "eager" }) {
  return <Illustration {...props} name="voice-clone-doodle-v2" />;
}

export function ReaderDoodle(props: Props) {
  return <Illustration {...props} name="ideas-doodle" />;
}

export function UnlockDoodle(props: Props) {
  return <Illustration {...props} name="access-doodle-v2" />;
}

export function HeroScene({ className }: { className?: string }) {
  const t = useT();
  return <div className={`overflow-hidden ${className ?? ""}`}>
    <Illustration name="voice-studio-doodle-v2" className="h-auto w-full scale-[1.14]" hero
      label={t("A hand-drawn Cambodian speaker at a microphone, with an audio speech bubble and notebook page")} />
  </div>;
}

type SceneProps = Props & { sizes?: string };

export function CreatorDoodle(props: SceneProps) {
  return <Illustration {...props} name="creator-doodle" />;
}

export function IdeasDoodle(props: SceneProps) {
  return <Illustration {...props} name="ideas-doodle" />;
}

export function DeveloperDoodle(props: SceneProps) {
  return <Illustration {...props} name="developer-doodle" />;
}
