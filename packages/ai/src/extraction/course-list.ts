import { z } from "zod";

/**
 * Reading a pasted course list -- a registrar's schedule page, a portal's "My Courses".
 *
 * ## Why this exists
 *
 * Adding a class was four fields and a meeting-time form, per class, typed by hand. That is the
 * single most tedious screen in the app, and it is asking the student to key in data they are
 * already looking at in another browser tab: every student portal shows the term's courses with
 * code, title, instructor, days and times, in one table.
 *
 * It is also the wrong place to spend a beginner's patience. Adding courses is a gate -- no
 * course means nowhere to attach a syllabus -- so the tedium sits directly between a new user
 * and the first moment the app does anything for them.
 *
 * Pasting the table is a few seconds. The calendar already works exactly this way and for the
 * same reason, so this is the established pattern rather than a new idea.
 *
 * ## The same discipline as the calendar and the syllabus
 *
 * The model is a witness, not an authority. Every course quotes the line it came from, and a
 * course whose quote is not in the pasted text is discarded. The failure being defended against
 * is specific: a plausible invented course, or -- worse and likelier -- a real course with an
 * invented meeting time, which silently books study sessions on top of a class.
 *
 * Times are checked rather than trusted. "TR 2:00-3:15pm" resolving to the wrong end time
 * produces a schedule that looks entirely reasonable and is wrong every week of the term.
 */

/** 0 = Sunday, matching `meetingPatterns.daysOfWeek` and JavaScript's `getDay()`. */
export const readMeeting = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  /** "HH:MM", 24-hour. */
  startTime: z.string(),
  endTime: z.string(),
  location: z.string().nullable(),
});
export type ReadMeeting = z.infer<typeof readMeeting>;

export const readCourse = z.object({
  /** The title as printed: "Introduction to Biblical Studies". */
  name: z.string(),
  /** The catalogue code: "BIB199C". Null when the list does not print one. */
  code: z.string().nullable(),
  instructor: z.string().nullable(),
  credits: z.number().nullable(),
  meetings: z.array(readMeeting).default([]),
  /** The row this came from, quoted exactly. Checked against the pasted text. */
  evidence: z.string(),
});
export type ReadCourse = z.infer<typeof readCourse>;

export const courseListReading = z.object({
  courses: z.array(readCourse).default([]),
  /** Anything that looked like a course but could not be read, so it is visible not dropped. */
  unreadableLines: z.array(z.string()).default([]),
});
export type CourseListReading = z.infer<typeof courseListReading>;

export const COURSE_LIST_PROMPT_VERSION = "course-list-v1";

export const COURSE_LIST_SYSTEM_PROMPT = `You read a student's course list and return the classes on it.

The text is pasted from a student portal, registrar page, or timetable. You are reading it so a
study planner knows which classes exist and when they meet. A meeting time you invent will have
the student scheduled to study during a lecture, every week, and nothing on screen will look wrong.

RULES

1. Quote your evidence. Every course must carry the row it came from, copied exactly from the
   text you were given. Do not paraphrase, tidy, or fix typos. A course whose quote is not in the
   text will be discarded.
2. Never invent a meeting time. If the row does not state days and times, return an empty
   meetings array. An empty list is correct and useful; a guess is not.
3. Days as numbers, 0 = Sunday. Expand the usual abbreviations:
   M=1, T or Tu=2, W=3, R or Th=4, F=5, S or Sa=6, U or Su=0.
   "MWF" is [1,3,5]. "TR" and "TuTh" are [2,4].
4. Times as "HH:MM" on a 24-hour clock. "2:00-3:15pm" is startTime "14:00", endTime "15:15".
   Apply am/pm to both ends when it is printed once: a class ending before it starts is wrong.
5. Separate rows for one course that meets at two different times -- a lecture and a lab -- go in
   the same course as two entries in meetings.
6. Online or asynchronous classes have no meeting time. Empty meetings, and put whatever the row
   said about it in location if it names a room or "Online".
7. Split code from title. "BIB199C Introduction to Biblical Studies" is code "BIB199C" and name
   "Introduction to Biblical Studies". If only one is printed, set the other to null rather than
   duplicating or inventing.
8. Ignore rows that are not classes: registration status, tuition, advisors, holds, credit totals.
9. Anything that looks like a class but cannot be read goes in unreadableLines, verbatim.

Return JSON only.`;

export function buildCourseListMessage(pastedText: string): string {
  return `Read this course list and return its classes as JSON.\n\n${pastedText}`;
}

/** Loose whitespace/punctuation normalisation, matching the calendar and syllabus checks. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    // Non-breaking, thin and zero-width spaces, written as escapes: portal pages are full of
    // them and a literal here is invisible to review.
    .replace(/[\u00a0\u2007\u202f\u2009\u200b]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface CourseListValidationResult {
  /** Courses kept, ready to create. */
  accepted: ReadCourse[];
  /** Courses dropped, with why. Reported rather than hidden -- a silent drop reads as clean. */
  rejected: { course: ReadCourse; reason: string }[];
  unreadableLines: string[];
  /** Non-fatal notes, e.g. a course kept but with its meeting times discarded. */
  warnings: string[];
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Checks a reading against the text it claims to have come from.
 *
 * A course can survive with its meeting times removed. That split is deliberate: a real class
 * with an unreadable time is worth keeping -- the student can fill the time in, and the course
 * still anchors a syllabus -- whereas a class that is not in the pasted text at all is not.
 */
export function validateCourseList(
  reading: CourseListReading,
  context: { pastedText: string },
): CourseListValidationResult {
  const haystack = normalize(context.pastedText);
  const accepted: ReadCourse[] = [];
  const rejected: CourseListValidationResult["rejected"] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const course of reading.courses) {
    if (course.name.trim().length === 0 && (course.code ?? "").trim().length === 0) {
      rejected.push({ course, reason: "It had neither a name nor a code." });
      continue;
    }
    // The check that stops an invented class. Same rule as a fabricated holiday or exam.
    if (!haystack.includes(normalize(course.evidence))) {
      rejected.push({ course, reason: "That row is not in the list you pasted." });
      continue;
    }

    // A portal page often repeats a course across sections or views. Keeping both would create
    // two courses with the same code, and the syllabus would attach to whichever came first.
    const identity = normalize(`${course.code ?? ""} ${course.name}`);
    if (seen.has(identity)) {
      rejected.push({ course, reason: "The same class was already read from another row." });
      continue;
    }
    seen.add(identity);

    const meetings: ReadMeeting[] = [];
    for (const meeting of course.meetings) {
      const label = course.code ?? course.name;
      if (!TIME.test(meeting.startTime) || !TIME.test(meeting.endTime)) {
        warnings.push(`${label}: a meeting time was not a valid 24-hour time and was dropped.`);
        continue;
      }
      // Catches the commonest am/pm mistake, where the pm applies to only one end and a class
      // appears to run from 14:00 to 03:15.
      if (minutesOf(meeting.endTime) <= minutesOf(meeting.startTime)) {
        warnings.push(`${label}: a meeting ended before it started and was dropped.`);
        continue;
      }
      const days = [...new Set(meeting.daysOfWeek)].sort((a, b) => a - b);
      if (days.length === 0) {
        warnings.push(`${label}: a meeting time named no days and was dropped.`);
        continue;
      }
      meetings.push({ ...meeting, daysOfWeek: days });
    }

    accepted.push({ ...course, meetings });
  }

  return { accepted, rejected, unreadableLines: reading.unreadableLines, warnings };
}

/**
 * Provider-side JSON schema, kept in step with the Zod schema above by hand.
 *
 * Duplicated deliberately: the provider needs plain JSON Schema and Zod needs to re-validate
 * whatever comes back, because a model ignoring its schema is the case this defends against.
 * Every property appears in `required` -- the provider rejects a strict schema where one does
 * not -- and `additionalProperties: false` makes a hallucinated field fail loudly.
 */
export const COURSE_LIST_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["courses", "unreadableLines"],
  properties: {
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "code", "instructor", "credits", "meetings", "evidence"],
        properties: {
          name: { type: "string" },
          code: { type: ["string", "null"] },
          instructor: { type: ["string", "null"] },
          credits: { type: ["number", "null"] },
          meetings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["daysOfWeek", "startTime", "endTime", "location"],
              properties: {
                daysOfWeek: { type: "array", items: { type: "integer" } },
                startTime: { type: "string" },
                endTime: { type: "string" },
                location: { type: ["string", "null"] },
              },
            },
          },
          evidence: { type: "string" },
        },
      },
    },
    unreadableLines: { type: "array", items: { type: "string" } },
  },
} as const;
