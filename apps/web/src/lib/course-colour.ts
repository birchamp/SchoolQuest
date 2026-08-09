import { colorTokenFor, type CourseColorToken, type ThemeName } from "@schoolquest/domain";

/**
 * One course, one colour, everywhere.
 *
 * This map existed in seven copies across six components. That is the exact shape of a
 * defect this codebase has already hit three times — the effort fallback drifted and made a
 * course table report zero projects for a term the Chronicle listed seven in; a sigil chip
 * was copied before its contrast fix landed and shipped cream lettering at 3.56:1; and the
 * colour itself was once keyed off list position, which gave one course two colours on two
 * screens that sorted differently.
 *
 * Widening the palette is what forced the issue: adding tokens meant editing seven maps, and
 * the seventh would have been the one that got missed.
 *
 * Colour is never load-bearing here. Every mark that uses it is paired with the course name
 * and its code letters, so a student who cannot distinguish two hues loses nothing.
 */

/**
 * Quest tinctures. All dark enough to carry parchment-coloured lettering at 4.5:1, because
 * the sigil is a filled chip with initials on it.
 */
const HERALDRY: Record<CourseColorToken, string> = {
  azure: "#2f4a6d",
  vermilion: "#8c2f28",
  verdant: "#3f6c45",
  amber: "#6b4a2a",
  violet: "#5a3b6b",
  sable: "#241a10",
  teal: "#1f5c5c",
  rose: "#7a3355",
  slate: "#3d4657",
};

/**
 * The same identities in mid-tones for the plain shell.
 *
 * The heraldic tinctures are tuned to sit on parchment and read as mud on a plain surface.
 * These are chosen to stay visible on both the light and dark plain grounds.
 */
const PLAIN_TINT: Record<CourseColorToken, string> = {
  azure: "#4a6fa5",
  vermilion: "#a8564e",
  verdant: "#4e8a5c",
  amber: "#9a7038",
  violet: "#7a5f9e",
  sable: "#6b6b80",
  teal: "#3d8f8f",
  rose: "#a85c82",
  slate: "#66708a",
};

/**
 * A fill guaranteed to carry white or parchment lettering.
 *
 * `PLAIN_TINT` is a set of *foreground* colours — chosen to stay legible as text and rules on
 * both plain grounds — and three of the nine are too light to sit under white lettering:
 * verdant measures 4.11:1, teal 3.80:1, amber 4.42:1. A filled sigil chip is a different job
 * from a coloured word, and using one for the other is the same defect the ledger already
 * records once. The heraldic set is dark by construction (6.1:1 at its lightest), so filled
 * chips take it under every theme.
 *
 * Use this for anything with text on top of it. Use `courseTincture` for text, rules, and
 * edges.
 */
export function courseChipFill(courseId: string, colorToken: string | null | undefined): string {
  return HERALDRY[colorTokenFor(courseId, colorToken)];
}

/** Keyed on the course's own identity, never on its position in whatever list is rendering. */
export function courseTincture(
  courseId: string,
  colorToken: string | null | undefined,
  quest: boolean,
): string {
  const token = colorTokenFor(courseId, colorToken);
  return quest ? HERALDRY[token] : PLAIN_TINT[token];
}

/**
 * Sigil lettering. Digits are skipped on purpose: "BIO 240" as a two-character mark reads
 * as "B2", which looks like a typo rather than a course.
 */
export function courseInitials(
  courseId: string,
  code: string | null | undefined,
  name: string | null | undefined,
): string {
  const source = code ?? name ?? courseId;
  const words = source.match(/[A-Za-z]+/g) ?? [];
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return (second ? first.slice(0, 1) + second.slice(0, 1) : first.slice(0, 3)).toUpperCase();
}

/**
 * The same identities as *text on the theme's own ground*, which is a different job.
 *
 * `courseTincture` returns a fill for a chip that carries pale lettering, so it is deliberately
 * dark. Used as a text colour it inverts the requirement -- and the week map did exactly that,
 * painting the beat-kind label in a chip fill. On Quest's parchment that happens to work; on
 * Mission's steel the amber measured 3.25:1 and on plain's white 4.42:1, both under the floor.
 *
 * These are the same hues lifted until they clear 4.5:1 on the ground they are used on. Mission
 * is a dark theme, so its set is light; the plain set stays as it is because plain has both a
 * light and a dark ground and one hex cannot serve both -- see the note in the README of this
 * problem, which is older than this function.
 */
const MISSION_INK: Record<CourseColorToken, string> = {
  azure: "#7fb0e8",
  vermilion: "#ef9a86",
  verdant: "#7ecb92",
  amber: "#e0b74e",
  violet: "#c0a0e0",
  sable: "#b6c2cc",
  teal: "#6fd3cf",
  rose: "#ef94bd",
  slate: "#a9b8cc",
};

/** A course's identity colour, safe to use as text on the given theme's ground. */
export function courseLabelInk(
  courseId: string,
  colorToken: string | null | undefined,
  theme: ThemeName,
): string {
  const token = colorTokenFor(courseId, colorToken);
  if (theme === "mission") return MISSION_INK[token];
  // Quest labels sit on parchment, where the heraldic tinctures are what they were tuned for.
  return theme === "quest" ? HERALDRY[token] : PLAIN_TINT[token];
}
