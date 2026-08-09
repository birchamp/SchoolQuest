import type { Course, GradingCategory, WorkItem } from "@schoolquest/domain";

/**
 * Everything the app does not know about this term, gathered into one place per course, with
 * the message to send about it already written.
 *
 * ## Why this exists
 *
 * The app asks good questions. It asks them in five different places. Measured on the
 * five-course test term: nine clarification questions still pending, spread across five
 * separate document-review panels; eight work items with no due date anywhere; three policies
 * extracted and rendered on no screen at all; fifty-three items whose duration is a per-type
 * constant. A student would have to open five review panels, a survey card and the assignments
 * table to see the shape of what is still unknown — and the audience for this product
 * (docs/01-product-brief.md) is precisely the one that will not.
 *
 * So this collapses it. One list per course, biggest consequence first, and a draft the student
 * can send without composing anything.
 *
 * ## Why the draft matters more than the list
 *
 * "Ask your professor when the second paper is due" is advice. It is also, for someone with
 * executive-function difficulty, a task with four hidden steps: work out what to ask, work out
 * how to phrase it politely, find the address, and start the message. Every one of those is a
 * place to stall, and the whole question dies at the first.
 *
 * A written message has none of those steps. It is the same move `askProfessor` makes in the
 * effort survey, applied to every kind of gap rather than one, and gathered per course so five
 * questions become one email instead of five.
 *
 * ## What it is careful not to do
 *
 * It never invents an answer. A missing due date stays missing and the item stays flagged; this
 * only makes the gap legible and actionable. And it asks only about things that change the
 * plan — a syllabus with no stated office hours is not a planning question, and the student's
 * attention is the scarcest thing in the system.
 *
 * Pure, like everything else in this package: it reads what is known and returns what to ask.
 */

/** How much a gap actually costs, which is what decides the order things are asked in. */
export type OpenQuestionKind =
  /** No date anywhere for graded work: it cannot be planned against a deadline at all. */
  | "missing_due_date"
  /** The model asked something and nobody answered it. */
  | "unanswered_clarification"
  /** A category with no weight, so the app cannot say what this work is worth. */
  | "unknown_weight"
  /** A course whose stated weights do not add up. */
  | "weights_incomplete"
  /** A policy that changes what late or absent costs, which the student should have seen. */
  | "unread_policy";

export interface OpenQuestion {
  id: string;
  courseId: string;
  kind: OpenQuestionKind;
  /** What the app does not know, in the student's terms. */
  question: string;
  /** What it costs to leave unanswered — always concrete, never "for accuracy". */
  stakes: string;
  /** One sentence, ready to paste into an email. Empty when this is not one to send. */
  askProfessor: string;
  /**
   * Whether this belongs in the message to the instructor.
   *
   * False for questions that only make sense with the app open — see `isSendable`.
   */
  sendable: boolean;
  /** Work items this bears on, so a screen can point at them. */
  workItemIds: string[];
  /**
   * The syllabus lines behind the question, when it came from a document.
   *
   * A question with no source is one the student cannot check -- and cannot tell apart from the
   * app having misread something.
   */
  evidence?: { page: number; excerpt: string }[];
}

export interface CourseQuestions {
  courseId: string;
  courseLabel: string;
  instructor: string | null;
  questions: OpenQuestion[];
  /**
   * The whole course's questions as one message, greeting to sign-off.
   *
   * Empty when there is nothing to ask, which is the state this screen is trying to reach.
   */
  draftMessage: string;
}

export interface OpenQuestionsResult {
  courses: CourseQuestions[];
  /** Total across every course, so a screen can say "eleven things nobody has answered". */
  questionCount: number;
  /** Courses with at least one open question. */
  coursesAffected: number;
}

/** A clarification the extractor raised and nobody has answered. */
export interface PendingClarification {
  id: string;
  courseId: string;
  question: string;
  /** Why the plan needs it, as the extractor phrased it. */
  why: string;
  /** Titles of the work it bears on, when it is about specific items. */
  relatesToTitles: string[];
  /** The syllabus lines it came from, already checked against the document. */
  evidence?: { page: number; excerpt: string }[];
}

/** A policy claim that was extracted, stored, and shown on no screen. */
export interface PendingPolicy {
  id: string;
  courseId: string;
  kind: string;
  summary: string;
}

export interface OpenQuestionsInput {
  courses: Course[];
  workItems: WorkItem[];
  gradingCategories: GradingCategory[];
  clarifications?: PendingClarification[];
  policies?: PendingPolicy[];
}

/** Terminal states: nothing about finished or abandoned work is worth an email. */
const CLOSED = new Set(["completed", "submitted", "canceled"]);

/** Ordered by what it costs the student, which is the order the questions are asked in. */
const KIND_ORDER: OpenQuestionKind[] = [
  "missing_due_date",
  "unanswered_clarification",
  "weights_incomplete",
  "unknown_weight",
  "unread_policy",
];

export function buildOpenQuestions(input: OpenQuestionsInput): OpenQuestionsResult {
  const byCourse = new Map<string, OpenQuestion[]>();
  const add = (q: OpenQuestion) => byCourse.set(q.courseId, [...(byCourse.get(q.courseId) ?? []), q]);

  const open = input.workItems.filter((w) => !CLOSED.has(w.status));

  // --- Work with no date anywhere. Grouped per course: five undated readings is one question.
  const undatedByCourse = new Map<string, WorkItem[]>();
  for (const item of open) {
    if (item.dueAt !== null) continue;
    undatedByCourse.set(item.courseId, [...(undatedByCourse.get(item.courseId) ?? []), item]);
  }
  for (const [courseId, items] of undatedByCourse) {
    const titles = items.map((i) => i.title).sort();
    add({
      id: `undated:${courseId}`,
      courseId,
      kind: "missing_due_date",
      question:
        items.length === 1
          ? `When is "${titles[0]}" due?`
          : `When are these ${items.length} due? ${titles.join(", ")}`,
      stakes:
        items.length === 1
          ? "Without a date it is planned with no deadline pressure, so it will keep losing to work that has one."
          : `Without dates these ${items.length} are planned with no deadline pressure, so they keep losing to work that has one.`,
      askProfessor:
        items.length === 1
          ? `Could you tell me the due date for ${titles[0]}? I could not find one in the syllabus.`
          : `Could you tell me the due dates for ${listWords(titles)}? I could not find them in the syllabus.`,
      sendable: true,
      workItemIds: items.map((i) => i.id).sort(),
    });
  }

  // --- Questions the extractor raised. Already phrased for the student; kept verbatim.
  for (const clarification of input.clarifications ?? []) {
    const sendable = isSendable(clarification);
    add({
      id: `clarify:${clarification.id}`,
      courseId: clarification.courseId,
      kind: "unanswered_clarification",
      question: clarification.question,
      stakes: clarification.why,
      askProfessor: sendable
        ? asAQuestion(clarification.question, clarification.relatesToTitles, clarification.evidence)
        : "",
      sendable,
      workItemIds: [],
      ...(clarification.evidence?.length ? { evidence: clarification.evidence } : {}),
    });
  }

  // --- Grading. Two distinct faults, and conflating them produces a false alarm on a document
  //     that states its scheme fully in points (docs/10-syllabus-gotchas.md §2.1, §2.3).
  const categoriesByCourse = new Map<string, GradingCategory[]>();
  for (const category of input.gradingCategories) {
    categoriesByCourse.set(category.courseId, [
      ...(categoriesByCourse.get(category.courseId) ?? []),
      category,
    ]);
  }
  for (const [courseId, categories] of categoriesByCourse) {
    const unweighted = categories.filter((c) => c.weightPercent === null);
    if (unweighted.length > 0) {
      const names = unweighted.map((c) => c.name).sort();
      add({
        id: `unweighted:${courseId}`,
        courseId,
        kind: "unknown_weight",
        question: `What ${unweighted.length === 1 ? "is" : "are"} ${listWords(names)} worth?`,
        stakes:
          "Work in a category with no weight cannot be ranked against the rest, so it may be scheduled behind something that matters far less.",
        askProfessor: `What percentage of the final grade ${
          unweighted.length === 1 ? "is" : "are"
        } ${listWords(names)} worth?`,
        sendable: true,
        workItemIds: [],
      });
      continue;
    }

    const stated = categories.reduce((sum, c) => sum + (c.weightPercent ?? 0), 0);
    // A point of tolerance: syllabi round, and 99% is not a missing category.
    if (stated > 0 && stated < 99) {
      add({
        id: `weights:${courseId}`,
        courseId,
        kind: "weights_incomplete",
        question: `The stated weights add up to ${round(stated)}%. What makes up the other ${round(
          100 - stated,
        )}%?`,
        stakes:
          "A missing category is work nobody has told the app about, so it will arrive as a surprise rather than as a plan.",
        askProfessor: `The syllabus lists categories adding up to ${round(
          stated,
        )}% of the grade. Could you tell me what makes up the remaining ${round(100 - stated)}%?`,
        sendable: true,
        workItemIds: [],
      });
    }
  }

  // --- Policies. Not questions in themselves; they are things the student should have read and
  //     which no screen has ever shown them (docs/10 §5.4).
  for (const policy of input.policies ?? []) {
    add({
      id: `policy:${policy.id}`,
      courseId: policy.courseId,
      kind: "unread_policy",
      question: `Confirm the ${policyNoun(policy.kind)} policy: ${policy.summary}`,
      stakes:
        "This changes what missing something costs, which is exactly what should decide the order work gets done in.",
      askProfessor: `Could you confirm the ${policyNoun(policy.kind)} policy for this course? I read it as: ${
        policy.summary
      }`,
      sendable: true,
      workItemIds: [],
    });
  }

  const coursesById = new Map(input.courses.map((c) => [c.id, c]));
  const result: CourseQuestions[] = input.courses
    .map((course) => {
      const questions = (byCourse.get(course.id) ?? []).sort(
        (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id),
      );
      return {
        courseId: course.id,
        courseLabel: label(coursesById.get(course.id)),
        instructor: course.instructor ?? null,
        questions,
        draftMessage: questions.length === 0 ? "" : draft(course, questions),
      };
    })
    .filter((c) => c.questions.length > 0);

  return {
    courses: result,
    questionCount: result.reduce((sum, c) => sum + c.questions.length, 0),
    coursesAffected: result.length,
  };
}

/**
 * The whole course's questions as one message.
 *
 * Written to be sent as it stands by someone who is not going to edit it — polite without being
 * elaborate, specific about what was already looked for, and short enough that an instructor
 * reads all of it. The student's name is not filled in: nobody wants an app signing for them,
 * and a trailing blank line is the clearest possible cue that this last bit is theirs.
 */
function draft(course: Course, questions: OpenQuestion[]): string {
  const sendable = questions.filter((q) => q.sendable);
  // Every question on the list was unsendable, so there is no message — the card still shows
  // them, because the student can settle those in review themselves.
  if (sendable.length === 0) return "";

  const greeting = course.instructor ? `Dear ${course.instructor},` : "Hello,";
  const subject = course.code ?? course.name;
  const lines = sendable.map((q) => `- ${q.askProfessor}`);
  return [
    greeting,
    "",
    `I am planning out my semester for ${subject} and there are a few things I could not find in the syllabus.`,
    "",
    ...lines,
    "",
    "Thank you for your time.",
    "",
  ].join("\n");
}

/**
 * "General Biology I (BIO 240)" — but not "General Biology I (BIO 240) (BIO 240)".
 *
 * Ingest names a course from the syllabus title, which routinely already carries the code, so
 * appending it unconditionally produced exactly that on every course in the test term.
 */
function label(course: Course | undefined): string {
  if (!course) return "this course";
  if (!course.code || course.name.includes(course.code)) return course.name;
  return `${course.name} (${course.code})`;
}

/** "a, b and c" — an Oxford-comma-free list, because this is going into an email. */
function listWords(words: string[]): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The extractor writes its questions to the student ("When is the midterm?"). Sent to an
 * instructor they want a softer opening, and they are already well-formed questions, so this
 * only prefixes rather than rewriting — rewriting a model's sentence with string surgery
 * produces worse English than leaving it alone.
 */
function asAQuestion(
  question: string,
  relatesToTitles: string[] = [],
  evidence: { page: number; excerpt: string }[] = [],
): string {
  const trimmed = question.trim();
  const asked = `Could you help me with this: ${trimmed}${trimmed.endsWith("?") ? "" : "?"}`;

  /**
   * Names the work, when the question does not name it itself.
   *
   * Read off the real screen: BIO 240's draft carried "3 items have dates that contradict the
   * rest of the syllabus. Which is right?" — a question no instructor can answer, because the
   * three items are named in the *why* the student sees and nowhere in the sentence being sent.
   * The titles were sitting right there on the claim.
   *
   * Deduplicated because they arrive duplicated: that same claim listed "Midterm Exam, Final
   * Exam, Midterm Exam", which reads as carelessness in an email to a professor.
   */
  const named = [...new Set(relatesToTitles)].filter((t) => !trimmed.includes(t));
  const about =
    named.length === 0
      ? asked
      : `${asked} (${named.length === 1 ? "This is about" : "These are"} ${listWords(named)}.)`;

  /**
   * Quote the syllabus back to its author.
   *
   * An instructor reading "which day is the Week 5 quiz due?" has to go and find what the
   * student is looking at before they can answer. Pasting the line removes that step, and it
   * removes the commonest reason a question like this gets a vague reply. One line only: the
   * point is to locate the question, not to reproduce the document.
   */
  const quoted = evidence[0];
  if (!quoted) return about;
  return `${about} Your syllabus says: "${quoted.excerpt.trim()}"`;
}

/**
 * Whether a clarification makes sense to someone who does not have this app open.
 *
 * Found by reading the real output rather than by reasoning about it. Among nine pending
 * clarifications on the test term, eight were good questions for an instructor and one was
 * *"Do these grading categories and weights look right?"* — a question aimed at the review
 * screen, whose subject is a list the reader cannot see. Emailed to a professor it is
 * unanswerable, and it arrived in the draft alongside eight that were fine.
 *
 * It came from the model, so it cannot be fixed at the source; the prompt now asks for
 * questions a professor could answer, and this is the check for when it does not comply.
 *
 * The test is whether the question points at something identifiable: a named piece of work, or
 * the document itself. A question that points only at "these" points at nothing. This is a
 * heuristic on model prose and is called one — it keeps a bad sentence out of an email, and a
 * question it wrongly excludes is still shown on screen, so the cost of being wrong is one
 * question the student sends themselves rather than one they never see.
 */
function isSendable(clarification: PendingClarification): boolean {
  if (clarification.relatesToTitles.length > 0) return true;
  return /\b(syllabus|schedule|section|handbook)\b/i.test(clarification.question);
}

function policyNoun(kind: string): string {
  switch (kind) {
    case "late_work":
      return "late work";
    case "attendance":
      return "attendance";
    case "materials":
      return "materials";
    case "academic_integrity":
      return "academic integrity";
    default:
      return "course";
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
