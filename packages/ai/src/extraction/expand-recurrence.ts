import type { ExtractedAssignment } from "./schema.js";
import { breakCovering, type TermWindow } from "./academic-weeks.js";

/**
 * Turn a stated recurrence into the assignments a student actually faces.
 *
 * The model reads the rule; this computes the instances. That split is the same one
 * `resolve-dates` uses for "Week 3", and for the same reason: reading a sentence is what a
 * language model is for, and counting Tuesdays between two dates is not. A model asked to
 * enumerate sixteen dates will get some of them wrong, and every one it gets wrong is a date a
 * student turns up on.
 *
 * Recall against the five fixture syllabuses was 67% before this existed, and every miss was
 * work stated as a rule rather than listed:
 *
 *   "A weekly fitness log is due each Sunday ... There are 14 logs"  → one undated item
 *   "A short response to the assigned reading is due each Tuesday"   → one undated item
 *
 * Forty per cent of one course's grade and fifteen per cent of another's, arriving on screen as
 * a single small thing. Work enumerated row by row in a schedule table was already captured
 * perfectly, so this closes the whole of the gap.
 *
 * ## Instances, not a recurrence rule
 *
 * Each occurrence becomes a real, separately dated assignment rather than one item carrying a
 * rule. It makes the list longer, which is a genuine cost. It is still the right trade for this
 * reader: "seen, planned, and accounted for" is the goal, a row is harder to skim past than a
 * rule, and every screen in the app — the map, the calendar, the health readings — already
 * knows how to count dated work and would each need teaching otherwise.
 */

/** Nobody's syllabus has more than this, and a runaway count should not become 400 rows. */
const MAX_INSTANCES = 60;

export type { TermWindow } from "./academic-weeks.js";

function toUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Every date in the term falling on `dayOfWeek` (0 = Sunday), **skipping breaks**.
 *
 * The break skip is not a refinement, it is the difference between right and wrong. ENG 230
 * says "a short response to the assigned reading is due each Tuesday in class"; counting raw
 * Tuesdays over the term gives sixteen, one of them Tuesday 24 November — Thanksgiving week,
 * when there is no class to be in. The right answer is fifteen, and a term that has not
 * supplied a break calendar cannot know that.
 *
 * A term with no calendar behaves exactly as before, which is the honest fallback: it produces
 * the count the raw calendar implies and nothing here can tell that it is one too many.
 */
function weekdaysInTerm(term: TermWindow, dayOfWeek: number): string[] {
  const out: string[] = [];
  const end = toUtc(term.termEndDate);
  const cursor = toUtc(term.termStartDate);
  // Walk to the first matching weekday, then stride a week at a time.
  while (cursor.getUTCDay() !== dayOfWeek && cursor <= end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  while (cursor <= end && out.length < MAX_INSTANCES) {
    const date = iso(cursor);
    if (breakCovering(date, term) === null) out.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}


/**
 * Every occurrence of any of these weekdays in the term, in date order.
 *
 * Interleaved rather than concatenated per weekday: a Monday/Wednesday quiz numbered by
 * `weekdaysInTerm` twice over would make "Quiz 2" the second Monday rather than the first
 * Wednesday, and every number a student saw would name the wrong day.
 */
function datesForWeekdays(term: TermWindow, days: readonly number[]): string[] {
  return days
    .flatMap((day) => weekdaysInTerm(term, day))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Expand one assignment into its occurrences. Returns the assignment untouched, as a single
 * element, when there is no recurrence to expand.
 *
 * Where the syllabus states a count and a day, the count wins and the dates come from the day —
 * "there are 14 logs" is a fact about the course and the fifteenth Sunday is not one. Where it
 * states a count and no day, the occurrences are dated `null` and carry the count, because
 * inventing a weekday would be inventing a deadline.
 */
export function expandRecurrence(
  assignment: ExtractedAssignment,
  term: TermWindow,
  /**
   * The weekdays the class meets, for rules stated per class session rather than per week.
   *
   * Read from the same syllabus by the same extraction, so this is not a second source to
   * disagree with -- it is the document answering its own question. Empty or absent leaves an
   * `everyClassMeeting` rule undated, which is the honest outcome and already flagged.
   */
  meetingDays: readonly number[] = [],
): ExtractedAssignment[] {
  const rule = assignment.recurrence;
  if (!rule) return [assignment];

  /**
   * A rule can fire on more than one day a week.
   *
   * "A quiz at the start of every class" in a Monday/Wednesday course is two a week, and
   * `dayOfWeek` holds one day. Asking the student which day it is has no correct answer, so
   * the days come from the meeting pattern instead -- and a course meeting twice gets twice
   * as many occurrences, which is the count that was wrong before.
   */
  const days = rule.everyClassMeeting
    ? [...new Set(meetingDays)].sort((a, b) => a - b)
    : rule.dayOfWeek === null
      ? []
      : [rule.dayOfWeek];

  // A per-class rule with no meeting days yet cannot be placed, so keep it as the single item it
  // was and hold on to the rule -- even when a count is stated. Exploding "there are 14 quizzes"
  // into fourteen undated rows would both strip the rule (so it can never be re-expanded once the
  // days are known) and bury the class list under fourteen dateless entries. One item that can
  // still be resolved beats fourteen that cannot.
  if (rule.everyClassMeeting && days.length === 0) return [assignment];

  const dates = days.length === 0 ? [] : datesForWeekdays(term, days);
  const total = Math.min(
    MAX_INSTANCES,
    rule.count ?? (dates.length || 0),
  );
  if (total <= 1) return [assignment];

  return Array.from({ length: total }, (_, i) => ({
    ...assignment,
    // Numbered so the student can tell one from another on a list, and so a plan that mentions
    // "Reading Response 7" is talking about a specific Tuesday.
    title: `${assignment.title} ${i + 1}`,
    dueDate: dates[i]
      ? {
          iso: dates[i]!,
          raw: assignment.dueDate.raw,
          time: assignment.dueDate.time,
          // Not "none": the document never printed this date, our arithmetic did. Claiming the
          // page stated it makes the validator strip it as an invented date, which is exactly
          // what it should do to a date nobody can point at.
          ambiguity: "derived_recurrence" as const,
        }
      : // More occurrences than the term has matching weekdays, or no weekday stated at all.
        // Undated is the honest answer and the app already flags it; a guessed date would be
        // worse than an admitted gap.
        { iso: null, raw: assignment.dueDate.raw, time: assignment.dueDate.time, ambiguity: "missing" as const },
    // The evidence stays the sentence that stated the rule. Every instance is derived from it,
    // and the validator checks excerpts against the page, so it has to remain verbatim.
    recurrence: null,
  }));
}

/** Expand every assignment in a list, preserving order. */
export function expandAll(
  assignments: readonly ExtractedAssignment[],
  term: TermWindow,
  meetingDays: readonly number[] = [],
): ExtractedAssignment[] {
  return assignments.flatMap((a) => expandRecurrence(a, term, meetingDays));
}
