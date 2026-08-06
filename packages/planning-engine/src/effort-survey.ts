import type { Course, GradingCategory, WorkItem } from "@schoolquest/domain";
import { DEFAULT_EFFORT_MINUTES } from "./scheduler.js";

/**
 * Decides what to ask the student about how long their work takes.
 *
 * A syllabus states what is due and never states how long it takes. Measured on the five-course
 * test semester: of 61 ingested work items, **5 carry an effort estimate**. The other 56 are
 * planned against `DEFAULT_EFFORT_MINUTES`, a table of per-type constants that knows nothing
 * about the course. So 95% of the term's plan — every "you have 4 hours of work today", every
 * at-risk warning, every "this will not fit" — rests on a guess, and the student is never told
 * which parts of it are guessed.
 *
 * ## Why not just ask about all 61
 *
 * Because the reader has executive-function difficulty, and a 61-field form is precisely the
 * wall this app exists to remove. It would also be answered badly: someone with time blindness
 * asked for sixty estimates gives sixty numbers of decreasing thought.
 *
 * Three things make the ask small enough to actually get answers:
 *
 * **Ask per family, not per item.** Thirteen weekly quizzes take about the same time as each
 * other. One question — "how long does studying for a BIO quiz usually take?" — settles all
 * thirteen. Sixty-one items collapse to roughly a dozen families.
 *
 * **Ask biggest first, and say how much is left.** Families are ranked by the total assumed
 * minutes at stake, so the first few questions are worth more than all the rest put together.
 * `shareOfAssumed` lets the screen say "these three cover 71% of what I'm guessing about",
 * which turns an open-ended chore into something with a visible end.
 *
 * **Offer anchors, not a number field.** The options are a ladder of durations described in
 * units of a student's day — "an evening", "a weekend" — windowed around what the app is
 * currently assuming, so the current guess is always visible as one of the choices and every
 * option on screen is plausible for that kind of work. Asking a time-blind student to type
 * "how many minutes" is asking for the one thing they are worst at.
 *
 * ## "I don't know" is a real answer
 *
 * Some of these genuinely cannot be answered by the student — a first-year has no idea what a
 * formal lab report costs, and the syllabus does not say. That is not a gap to paper over with
 * a default; it is a question for the instructor, and `askProfessor` is written to be sent as
 * it stands. The estimate stays flagged as assumed in the meantime, which is the honest state.
 *
 * Nothing here writes anything. It reads the term and returns what is worth asking.
 */

/**
 * Durations a student can actually picture, in minutes.
 *
 * Chosen so that consecutive rungs are far enough apart to be a real choice — the difference
 * between 45 and 60 minutes is not a decision anyone can make about work they have not done
 * yet, and offering it invites false precision.
 */
const LADDER: readonly { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes — a quick pass" },
  { minutes: 30, label: "half an hour — one sitting" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 60, label: "an hour" },
  { minutes: 90, label: "an hour and a half" },
  { minutes: 120, label: "2 hours — an evening" },
  { minutes: 180, label: "3 hours" },
  { minutes: 240, label: "4 hours — a long evening" },
  { minutes: 360, label: "6 hours — most of a day" },
  { minutes: 480, label: "8 hours — a weekend" },
  { minutes: 720, label: "12 hours — several sittings" },
];

/** Rungs shown below and above the current assumption. Six options fit on a phone. */
const RUNGS_BELOW = 2;
const RUNGS_ABOVE = 3;

/**
 * Work the student never *does* — they sit it, and what the plan schedules is the revision.
 *
 * Asking "how long does one of MAT 205's exams take you?" gets the honest and useless answer
 * "fifty minutes, it's in class". The scheduler is placing study blocks; the number it needs
 * is preparation time, and class time comes from the meeting patterns, not from here. So these
 * types get a question about getting ready rather than about the thing itself.
 */
const SAT_NOT_DONE = new Set(["exam", "quiz"]);

/** Plain names for work types, for questions that read like a person wrote them. */
const TYPE_NOUN: Record<string, { one: string; many: string }> = {
  reading: { one: "reading", many: "readings" },
  quiz: { one: "quiz", many: "quizzes" },
  quiz_prep: { one: "quiz revision", many: "quiz revision sessions" },
  problem_set: { one: "problem set", many: "problem sets" },
  paper: { one: "paper", many: "papers" },
  presentation: { one: "presentation", many: "presentations" },
  group_project: { one: "group project", many: "group projects" },
  exam: { one: "exam", many: "exams" },
  exam_prep: { one: "exam revision", many: "exam revision sessions" },
  lab: { one: "lab", many: "labs" },
  discussion: { one: "discussion post", many: "discussion posts" },
  milestone: { one: "milestone", many: "milestones" },
  other: { one: "assignment", many: "assignments" },
};

/** What the student is being asked to estimate, for one family of work. */
export interface EffortOption {
  minutes: number;
  label: string;
  /** True for the rung the app is currently planning against. */
  isCurrentAssumption: boolean;
}

export interface EffortQuestion {
  /** Stable across runs: `${courseId}:${workType}`. Safe to use as a form key. */
  id: string;
  courseId: string;
  courseLabel: string;
  workType: string;
  /** Every item this answer would set, so applying it is one write per id. */
  workItemIds: string[];
  itemCount: number;
  /** Minutes each item is currently assumed to take. */
  assumedMinutesEach: number;
  /** Assumed minutes across the whole family. */
  assumedMinutesTotal: number;
  /**
   * Fraction of *all* assumed minutes in the term this one question settles, 0..1. The number
   * that lets a screen promise an end to the asking.
   */
  shareOfAssumed: number;
  /** Share of the course grade this family carries, when the weights are known. */
  gradeSharePercent: number | null;
  question: string;
  /** What answering it changes, in the student's terms. */
  stakes: string;
  /** Ready to send, for when the student genuinely cannot know. */
  askProfessor: string;
  options: EffortOption[];
}

export interface EffortSurvey {
  /** Biggest stake first. Empty when every remaining item has a real estimate. */
  questions: EffortQuestion[];
  /** Remaining minutes resting on a per-type default. */
  assumedMinutes: number;
  /** Remaining minutes the student or the syllabus actually gave us. */
  knownMinutes: number;
  /** 0..1 share of remaining effort that rests on a real number. The headline. */
  groundedFraction: number;
  /** Items still ahead with no estimate of their own. */
  assumedItemCount: number;
  /** Items still ahead in total. */
  itemCount: number;
}

export interface EffortSurveyInput {
  workItems: readonly WorkItem[];
  courses: readonly Course[];
  gradingCategories: readonly GradingCategory[];
}

/** Work that is finished, abandoned, or planned through stages is not worth asking about. */
function isOpenLeaf(item: WorkItem, parentsWithStages: ReadonlySet<string>): boolean {
  if (item.status === "completed" || item.status === "canceled") return false;
  // A decomposed project is scheduled through its stages; its own remaining is zeroed, and
  // asking about it would double-count the same hours.
  if (parentsWithStages.has(item.id)) return false;
  return true;
}

function courseLabel(course: Course | undefined): string {
  if (!course) return "This course";
  return course.code ?? course.name;
}

/** The rung nearest a number of minutes. Ties go to the longer one — under-estimating hurts. */
function nearestRung(minutes: number): number {
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < LADDER.length; i++) {
    const gap = Math.abs(LADDER[i]!.minutes - minutes);
    if (gap <= bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

function optionsAround(assumed: number): EffortOption[] {
  const centre = nearestRung(assumed);
  const from = Math.max(0, Math.min(centre - RUNGS_BELOW, LADDER.length - (RUNGS_BELOW + RUNGS_ABOVE + 1)));
  const to = Math.min(LADDER.length, from + RUNGS_BELOW + RUNGS_ABOVE + 1);
  return [
    ...LADDER.slice(from, to).map((rung, i) => ({
      minutes: rung.minutes,
      label: rung.label,
      isCurrentAssumption: from + i === centre,
    })),
    /**
     * Last, and always offered.
     *
     * Some graded work costs nothing to plan for — attendance, participation, an in-class quiz
     * nobody revises for. Without this the student's only honest answers are a duration they
     * know is wrong or "I don't know", and the shortest rung on the ladder still books a quarter
     * of an hour of fiction into their week, times however many items are in the family.
     */
    { minutes: NO_TIME_NEEDED, label: "no time needed — it takes care of itself", isCurrentAssumption: false },
  ];
}

function noun(workType: string, plural: boolean): string {
  const entry = TYPE_NOUN[workType] ?? TYPE_NOUN["other"]!;
  return plural ? entry.many : entry.one;
}

/** "4 hours", "90 minutes", "2 hours 30 minutes" — never "240 min". */
export function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 1 ? "1 hour" : `${hours} hours`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minutes`;
}

/**
 * What share of the course grade a family of work carries.
 *
 * Only answerable when the syllabus gave category weights, which is why extraction bothers to
 * capture them. Null means unknown, and the caller must say nothing rather than imply zero.
 */
function gradeShare(
  items: readonly WorkItem[],
  categoriesById: ReadonlyMap<string, GradingCategory>,
): number | null {
  const weights = new Map<string, number>();
  for (const item of items) {
    if (!item.gradingCategoryId) continue;
    const category = categoriesById.get(item.gradingCategoryId);
    if (!category || category.weightPercent === null) continue;
    // A whole category counted once, however many of its items are in this family: thirteen
    // quizzes worth 20% between them are 20% of the grade, not 260%.
    weights.set(category.id, category.weightPercent);
  }
  if (weights.size === 0) return null;
  return [...weights.values()].reduce((a, b) => a + b, 0);
}

/**
 * Reads the term and returns what is worth asking, biggest stake first.
 *
 * Pure: same input, same questions, same order. Ties break on the family id so two runs of the
 * same term never reorder the screen under the student.
 */
export function buildEffortSurvey(input: EffortSurveyInput): EffortSurvey {
  const parentsWithStages = new Set(
    input.workItems.map((w) => w.parentWorkItemId).filter((id): id is string => id !== null),
  );
  const coursesById = new Map(input.courses.map((c) => [c.id, c]));
  const categoriesById = new Map(input.gradingCategories.map((g) => [g.id, g]));

  const open = input.workItems.filter((item) => isOpenLeaf(item, parentsWithStages));

  let knownMinutes = 0;
  let assumedMinutes = 0;
  let assumedItemCount = 0;
  const families = new Map<string, WorkItem[]>();

  for (const item of open) {
    // remainingMinutes is what is still owed and is set from estimatedMinutes at creation, so
    // either one being present means somebody put a real number on this.
    const given = item.remainingMinutes ?? item.estimatedMinutes;
    if (given !== null) {
      knownMinutes += given;
      continue;
    }
    assumedMinutes += DEFAULT_EFFORT_MINUTES[item.workType] ?? 60;
    assumedItemCount++;
    const key = `${item.courseId}:${item.workType}`;
    families.set(key, [...(families.get(key) ?? []), item]);
  }

  const questions: EffortQuestion[] = [...families.entries()]
    .map(([id, items]) => {
      const first = items[0]!;
      const course = coursesById.get(first.courseId);
      const label = courseLabel(course);
      const each = DEFAULT_EFFORT_MINUTES[first.workType] ?? 60;
      const total = each * items.length;
      const share = gradeShare(items, categoriesById);
      const plural = items.length > 1;
      const thing = noun(first.workType, plural);

      return {
        id,
        courseId: first.courseId,
        courseLabel: label,
        workType: first.workType,
        // Sorted so the write order is stable and a diff of two surveys is readable.
        workItemIds: items.map((w) => w.id).sort(),
        itemCount: items.length,
        assumedMinutesEach: each,
        assumedMinutesTotal: total,
        shareOfAssumed: 0, // filled below, once the term total is known
        gradeSharePercent: share,
        question: questionLine({ label, thing, plural, title: first.title, workType: first.workType }),
        stakes: stakesLine({
          label,
          plural,
          count: items.length,
          each,
          total,
          share,
          prep: SAT_NOT_DONE.has(first.workType),
        }),
        askProfessor: professorLine({ label, thing, plural, title: first.title, workType: first.workType }),
        options: optionsAround(each),
      };
    })
    .map((q) => ({
      ...q,
      shareOfAssumed: assumedMinutes > 0 ? q.assumedMinutesTotal / assumedMinutes : 0,
    }))
    .sort(
      (a, b) =>
        b.assumedMinutesTotal - a.assumedMinutesTotal ||
        (b.gradeSharePercent ?? 0) - (a.gradeSharePercent ?? 0) ||
        a.id.localeCompare(b.id),
    );

  const totalMinutes = knownMinutes + assumedMinutes;

  return {
    questions,
    assumedMinutes,
    knownMinutes,
    groundedFraction: totalMinutes > 0 ? knownMinutes / totalMinutes : 1,
    assumedItemCount,
    itemCount: open.length,
  };
}

function questionLine(a: {
  label: string;
  thing: string;
  plural: boolean;
  title: string;
  workType: string;
}): string {
  if (SAT_NOT_DONE.has(a.workType)) {
    return a.plural
      ? `How long do you usually need to get ready for one of ${a.label}'s ${a.thing}?`
      : `How long will you need to get ready for ${a.label}'s ${a.title}?`;
  }
  return a.plural
    ? `How long does one of ${a.label}'s ${a.thing} usually take you?`
    : `How long do you think ${a.label}'s ${a.title} will take?`;
}

function stakesLine(a: {
  label: string;
  plural: boolean;
  count: number;
  each: number;
  total: number;
  share: number | null;
  prep: boolean;
}): string {
  // Named explicitly for things that are sat rather than done, because "1 hour each" against
  // an exam otherwise reads as the length of the exam and the student corrects the wrong number.
  const what = a.prep ? "revising" : "";
  const scale = a.plural
    ? `${a.count} of these left, and I'm assuming ${humanMinutes(a.each)}${what ? ` ${what}` : ""} each — ` +
      `${humanMinutes(a.total)} across the term.`
    : `I'm assuming ${humanMinutes(a.each)}${what ? ` ${what}` : ""}.`;
  // Weight is the reason to care, when the syllabus gave it. Without it, say nothing: an
  // invented percentage on a screen about honesty would be a strange place to start guessing.
  const weight =
    a.share === null
      ? ""
      : ` They're ${Math.round(a.share)}% of your ${a.label} grade.`;
  return `${scale}${weight}`;
}

function professorLine(a: {
  label: string;
  thing: string;
  plural: boolean;
  title: string;
  workType: string;
}): string {
  // The question that gets a useful answer differs by what the work is. Asking an instructor
  // "how long does the exam take" gets the length of the exam; asking how much preparation
  // students typically need gets the number the plan is actually short of.
  if (SAT_NOT_DONE.has(a.workType)) {
    const subject = a.plural ? `each of the ${a.thing} in ${a.label}` : `"${a.title}"`;
    return (
      `Hi — I'm planning my study time for the semester. How much preparation would you ` +
      `expect ${subject} to need? I'd rather block the time out early than cram.`
    );
  }
  return a.plural
    ? `Hi — I'm planning my study time for the semester. Roughly how long should I expect ` +
      `each of the ${a.thing} in ${a.label} to take? I want to block out enough time rather ` +
      `than starting them too late.`
    : `Hi — I'm planning my study time for the semester. Roughly how long should I expect ` +
      `"${a.title}" to take? I want to block out enough time rather than starting it too late.`;
}

/**
 * The answer applied: which items to write, and what to write on them.
 *
 * Returned rather than written so the caller owns persistence and the decision stays testable.
 * `remainingMinutes` moves with `estimatedMinutes` for work not yet started, because a student
 * saying "these take two hours" means two hours are still owed — but an item already part-done
 * keeps its remaining, since the answer is about the size of the job, not about what is left of
 * this particular one.
 *
 * `NO_TIME_NEEDED` (zero) is a real answer and not an absence of one. Some graded work genuinely
 * costs nothing to plan for: an attendance mark, a participation grade, an in-class quiz the
 * student does not revise for, a reading they will do while the lecture happens. Forcing thirty
 * minutes onto each of those does not make the plan safer — it fills the week with blocks the
 * student knows are fiction, and a plan they know is fiction is a plan they stop opening.
 *
 * It is deliberately not the same as "I don't know" (null), which leaves the assumption standing
 * and hands over a sentence for the instructor.
 */
export const NO_TIME_NEEDED = 0;
export function applyEffortAnswer(
  question: EffortQuestion,
  minutes: number,
  items: readonly WorkItem[],
): { workItemId: string; estimatedMinutes: number; remainingMinutes: number }[] {
  const inFamily = new Set(question.workItemIds);
  return items
    .filter((item) => inFamily.has(item.id))
    .map((item) => ({
      workItemId: item.id,
      estimatedMinutes: minutes,
      remainingMinutes: item.status === "not_started" ? minutes : (item.remainingMinutes ?? minutes),
    }));
}
