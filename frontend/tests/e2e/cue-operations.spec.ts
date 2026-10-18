import { expect, test } from "@playwright/test";
import { cueError, mergeCue, parseCueTime, splitCue, splitCueText } from "../../src/lib/cueEditing";
import { subtitleText } from "../../src/lib/subtitles";

test("millisecond parsing and subtitle export preserve hour rollover and reject malformed boundaries", () => {
  expect(parseCueTime("01:00:00.001")).toBe(3600.001);
  expect(parseCueTime("1:02.5")).toBe(62.5);
  expect(parseCueTime(" 2,125 ")).toBe(2.125);
  expect(parseCueTime("1000:00:00.000")).toBe(3600000);
  for (const invalid of ["", "-1", "NaN", "Infinity", "1e3", "0:60:00", "00:00:60", "1.0001", "3600001", "1.2abc"])
    expect(parseCueTime(invalid)).toBeNull();
  const split = splitCue([{ start: 3599.5, end: 3601.125, text: "Hello world" }], 0, 3600.001, "Hello", "world");
  expect(subtitleText(split, "srt")).toBe("1\n00:59:59,500 --> 01:00:00,001\nHello\n\n2\n01:00:00,001 --> 01:00:01,125\nworld\n");
  expect(subtitleText(split, "vtt")).toContain("01:00:00.001 --> 01:00:01.125");
});

test("splitting preserves Khmer combining marks and emoji, and keeps overlapping cues ordered", () => {
  const original = "សួស្តី 👨‍👩‍👧‍👦 Hello";
  const boundaries = new Set([0, ...Array.from(new Intl.Segmenter("km", { granularity: "grapheme" }).segment(original), s => s.index + s.segment.length)]);
  for (let caret = 0; caret <= original.length; caret++) {
    const parts = splitCueText(original, caret);
    expect(parts.join("")).toBe(original);
    expect(boundaries.has(parts[0].length)).toBe(true);
  }
  const cues = [{ start: 0, end: 8, text: original }, { start: 2, end: 3, text: "Other speaker" }];
  const result = splitCue(cues, 0, 4, "សួស្តី", "Hello");
  expect(result.map(s => s.start)).toEqual([0, 2, 4]);
  expect(result[1].text).toBe("Other speaker");
  expect(cueError(result, 8)).toBeNull();
  expect(() => splitCue(cues, 0, 8, "a", "b")).toThrow("Split time must be inside");
});

test("merge preserves the entire span including overlaps and silence and rejects oversized text", () => {
  const nested = [{ start: 0, end: 8, text: "First" }, { start: 2, end: 3, text: "Second" }];
  expect(mergeCue(nested, 0)).toEqual([{ start: 0, end: 8, text: "First Second" }]);
  const gap = mergeCue([{ start: 1, end: 2, text: "a" }, { start: 4, end: 5, text: "b" }], 0);
  expect(gap[0]).toEqual({ start: 1, end: 5, text: "a b" });
  const excessive = mergeCue(nested.map(s => ({ ...s, text: "a".repeat(6000) })), 0);
  expect(cueError(excessive, 8)).toContain("10,000 characters");
  expect(cueError([{ start: 1, end: 1.0001, text: "a" }], 8)).toContain("one millisecond");
});
