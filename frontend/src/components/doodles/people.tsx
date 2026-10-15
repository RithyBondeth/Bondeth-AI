"use client";

import { Fill, Stroke, usePattern, type PatternName } from "./Doodle";

/**
 * Parts for the doodle people: hands and a head-and-shoulders bust.
 *
 * Bold ink outlines, flat fills, one print per outfit. Skin, hair and face colours come
 * from the --skin, --hair and --face tokens so the people read in both themes.
 */

type At = { x: number; y: number; rotate?: number; scale?: number; i?: number };

const place = ({ x, y, rotate = 0, scale = 1 }: At) => `translate(${x} ${y}) rotate(${rotate}) scale(${scale})`;

/** A fist gripping something; the grip is at the origin and the knuckles face +x. */
export function Fist(at: At) {
  return (
    <g transform={place(at)}>
      <Stroke i={at.i} fill="var(--skin)"
        d="M-11 -9 C-6 -14 6 -14 11 -9 C15 -4 15 7 10 11 C4 15 -6 15 -11 10 C-15 5 -15 -4 -11 -9 Z" />
      <Stroke i={at.i} d="M2 -12 C3 -6 3 6 2 12 M8 -9 C9 -3 9 4 8 9" strokeWidth={2.2} />
      <Stroke i={at.i} d="M-12 -4 C-6 -7 0 -6 2 -1" strokeWidth={2.4} />
    </g>
  );
}

/** An open hand, fingers up, with the wrist at the origin. */
export function Palm({ dashed, ...at }: At & { dashed?: boolean }) {
  const d = "M-8 0 C-11 -5 -12 -10 -12 -15 L-13 -25 C-13 -30 -7 -30 -7 -25 L-6 -18 L-6 -32 C-6 -37 0 -37 0 -32 L0 -19 L1 -34 C1 -39 7 -39 7 -34 L6 -19 L8 -30 C9 -35 15 -34 14 -29 L11 -14 C15 -19 21 -19 21 -13 C18 -6 13 -1 8 0 Z";
  return (
    <g transform={place(at)}>
      {dashed
        ? <Fill i={at.i} d={d} fill="var(--surface)" stroke="var(--lilac)" strokeDasharray="5 6" />
        : <Stroke i={at.i} d={d} fill="var(--skin)" />}
    </g>
  );
}

/** A thumb seen from the front, pressing on the edge of something held. */
export function Thumb(at: At) {
  return (
    <g transform={place(at)}>
      <Stroke i={at.i} fill="var(--skin)" d="M-5 -9 C0 -12 5 -9 5 -2 C5 5 2 10 -2 10 C-6 10 -7 3 -7 -2 C-7 -5 -7 -7 -5 -9 Z" />
    </g>
  );
}

export type Hair = "long" | "bun" | "short";
export type Face = "smile" | "talk" | "closed";

/** Translucent cheeks. Set in the colour, not `opacity`, which the pop-in animation drives. */
export const BLUSH = "color-mix(in oklab, var(--rose) 35%, transparent)";

const TORSO = "M18 132 C18 102 34 88 50 85 C54 93 66 93 70 85 C86 88 102 102 102 132 Z";
const HEAD = "M60 18 C80 18 86 34 85 50 C84 68 74 78 60 78 C46 78 36 68 35 50 C34 32 42 18 60 18 Z";
const HAIR_BACK = "M37 44 C30 70 31 98 38 114 L82 114 C89 98 90 70 83 44 Z";
const HAIR_FRONT: Record<Hair, string> = {
  long: "M35 50 C33 28 46 15 62 15 C78 15 88 30 85 50 C76 44 67 34 63 25 C57 38 46 46 35 50 Z",
  bun: "M35 46 C34 26 46 17 60 17 C76 17 87 26 85 46 C78 36 70 30 60 30 C52 34 42 38 35 46 Z",
  short: "M35 46 C30 22 46 11 63 12 C80 13 90 26 85 46 C82 36 76 30 68 28 C58 34 46 36 35 46 Z",
};

type BustProps = {
  top?: string;
  print?: PatternName;
  hair?: Hair;
  face?: Face;
  /** Draw as a dashed lilac outline: the voice clone of someone. */
  dashed?: boolean;
  i?: number;
};

/** Head and shoulders in a 120×132 box: head centred at (60, 48), shoulders along the bottom. */
export function Bust({ top = "var(--lilac)", print, hair = "long", face = "smile", dashed = false, i = 0 }: BustProps) {
  const hatch = usePattern("hatch");
  const fabric = usePattern(print ?? "dots");

  if (dashed) {
    const line = { stroke: "var(--lilac)", strokeDasharray: "6 7" };
    const feature = { stroke: "var(--lilac)" };
    return (
      <g>
        {hair === "long" && <Fill i={i} d={HAIR_BACK} fill={hatch} {...line} />}
        <Fill i={i} d={TORSO} fill="var(--surface)" {...line} />
        <Fill i={i + 0.2} d="M52 72 L52 88 C56 92 64 92 68 88 L68 72" fill="var(--surface)" {...line} />
        <Fill i={i + 0.3} d={HEAD} fill="var(--surface)" {...line} />
        {hair === "bun" && <Fill i={i + 0.4} d="M50 11 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0" fill={hatch} {...line} />}
        <Fill i={i + 0.4} d={HAIR_FRONT[hair]} fill={hatch} {...line} />
        <Features face={face} i={i + 0.6} dashed {...feature} />
      </g>
    );
  }

  return (
    <g>
      {hair === "long" && <Fill i={i} d={HAIR_BACK} fill="var(--hair)" stroke="currentColor" />}
      <Stroke i={i} d={TORSO} fill={top} />
      {print && <Fill i={i + 0.6} d={TORSO} fill={fabric} stroke="none" />}
      <Stroke i={i + 0.2} d="M52 72 L52 88 C56 92 64 92 68 88 L68 72" fill="var(--skin)" />
      <Stroke i={i + 0.3} d={HEAD} fill="var(--skin)" />
      {hair === "bun" && <Fill i={i + 0.4} d="M50 11 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0" fill="var(--hair)" stroke="currentColor" />}
      <Fill i={i + 0.4} d={HAIR_FRONT[hair]} fill="var(--hair)" stroke="currentColor" />
      <Features face={face} i={i + 0.6} />
    </g>
  );
}

/** Eyes, mouth and blush for a head at the Bust's position. */
export function Features({ face, i, dashed, stroke = "var(--face)" }: { face: Face; i: number; dashed?: boolean; stroke?: string }) {
  return (
    <g>
      {face === "closed"
        ? <Stroke i={i} d="M45 52 Q50 56 55 52 M65 52 Q70 56 75 52" stroke={stroke} strokeWidth={3} />
        : <Stroke i={i} d="M50 50 L50 53 M70 50 L70 53" stroke={stroke} strokeWidth={4.5} />}
      {face === "talk"
        ? <Fill i={i + 0.2} d="M53 62 C55 70 65 70 67 62 Z" fill={dashed ? "none" : "var(--face)"} stroke={stroke} strokeWidth={2.5} />
        : <Stroke i={i + 0.2} d="M53 62 Q60 68 67 62" stroke={stroke} strokeWidth={3} />}
      {!dashed && (
        <>
          <Fill i={i + 0.3} d="M39 61 a5 3 0 1 0 10 0 a5 3 0 1 0 -10 0" fill={BLUSH} stroke="none" />
          <Fill i={i + 0.3} d="M71 61 a5 3 0 1 0 10 0 a5 3 0 1 0 -10 0" fill={BLUSH} stroke="none" />
        </>
      )}
    </g>
  );
}
