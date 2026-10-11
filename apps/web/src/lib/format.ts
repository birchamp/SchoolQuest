import type { Course } from "@schoolquest/domain";

/**
 * Small display formatters shared across screens.
 *
 * Each of these was copied byte-for-byte into four or five components (issue #33). A copy is a
 * place for the wording to drift, and the whole point of them is that minutes, course names
 * and sigil letters read the same on every screen.
 */

/** Only the fields the formatters read, so a component's own course shape can be passed too. */
type CourseNaming = Pick<Course, "name" | "code">;

/** "95" -> "1h 35m". Minutes alone stop being legible somewhere past a couple of hours. */
export function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Course names sometimes already carry the code ("General Biology I (BIO 240)"); appending
 * it again produced "(BIO 240) (BIO 240)" in group headers. The code is therefore appended
 * only when the name does not already contain it.
 */
export function courseNameWithCode(course: CourseNaming): string {
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

/**
 * `courseNameWithCode`, with a stand-in built from the id for a course the view no longer
 * has (deleted, or not in this payload).
 */
export function courseLabel(course: CourseNaming | undefined, courseId: string): string {
  if (!course) return `Course ${courseId.slice(0, 6)}`;
  return courseNameWithCode(course);
}

/**
 * Sigil lettering, shared so every screen marks a course the same way. Digits are skipped on
 * purpose: "BIO 240" as a two-character mark reads as "B2", which looks like a typo rather
 * than a course.
 */
export function initialsFor(course: CourseNaming | undefined, courseId: string): string {
  const source = course?.code ?? course?.name ?? courseId;
  const words = source.match(/[A-Za-z]+/g) ?? [];
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return (second ? first.slice(0, 1) + second.slice(0, 1) : first.slice(0, 3)).toUpperCase();
}
