import { describe, expect, it } from "vitest";

import { validateCourseList, type CourseListReading, type ReadCourse } from "./course-list.js";

const PASTED = `
My Courses - Fall 2026
BIB199C  Introduction to Biblical Studies   Dr. Reyes   MWF 9:00-9:50am   Hale 204
CCO202   Christian Theology I               Dr. Okafor  TR 2:00-3:15pm    Hale 110
SCI106   Physical Science                   Dr. Nakamura  T 6:00-8:45pm   Lab 3
Registered - 12 credits
`;

const course = (over: Partial<ReadCourse> = {}): ReadCourse => ({
  name: "Introduction to Biblical Studies",
  code: "BIB199C",
  instructor: "Dr. Reyes",
  credits: 3,
  meetings: [{ daysOfWeek: [1, 3, 5], startTime: "09:00", endTime: "09:50", location: "Hale 204" }],
  evidence: "BIB199C  Introduction to Biblical Studies   Dr. Reyes   MWF 9:00-9:50am   Hale 204",
  ...over,
});

const reading = (courses: ReadCourse[]): CourseListReading => ({ courses, unreadableLines: [] });
const run = (courses: ReadCourse[]) =>
  validateCourseList(reading(courses), { pastedText: PASTED });

describe("validateCourseList", () => {
  it("keeps a course whose row is in the pasted text", () => {
    const result = run([course()]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({ code: "BIB199C", instructor: "Dr. Reyes" });
    expect(result.rejected).toEqual([]);
  });

  it("tolerates whitespace and punctuation differences in the quote", () => {
    // Portal pages are full of non-breaking spaces; an exact-match check would reject real rows.
    const result = run([course({ evidence: "BIB199C Introduction to Biblical Studies" })]);
    expect(result.accepted).toHaveLength(1);
  });

  describe("fabrication", () => {
    it("discards a course that is not in the pasted text", () => {
      // The whole point. A plausible invented class would otherwise become a real course with
      // real study sessions attached to it.
      const invented = course({ code: "PHI300", name: "Ethics", evidence: "PHI300 Ethics MW 1:00" });
      const result = run([invented]);
      expect(result.accepted).toEqual([]);
      expect(result.rejected[0]?.reason).toContain("not in the list you pasted");
    });

    it("discards a course with neither a name nor a code", () => {
      expect(run([course({ name: "  ", code: null })]).accepted).toEqual([]);
    });
  });

  describe("meeting times", () => {
    it("drops a meeting that ends before it starts, and keeps the course", () => {
      // The commonest am/pm mistake: "2:00-3:15pm" read as 14:00 to 03:15. Keeping the course
      // matters -- a real class with an unreadable time is still worth having.
      const result = run([
        course({
          meetings: [{ daysOfWeek: [2, 4], startTime: "14:00", endTime: "03:15", location: null }],
        }),
      ]);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]!.meetings).toEqual([]);
      expect(result.warnings.join(" ")).toContain("ended before it started");
    });

    it("drops a meeting whose times are not valid 24-hour times", () => {
      const result = run([
        course({
          meetings: [{ daysOfWeek: [1], startTime: "9:00am", endTime: "25:99", location: null }],
        }),
      ]);
      expect(result.accepted[0]!.meetings).toEqual([]);
      expect(result.warnings.join(" ")).toContain("not a valid 24-hour time");
    });

    it("drops a meeting that names no days", () => {
      const result = run([
        course({
          meetings: [{ daysOfWeek: [], startTime: "09:00", endTime: "09:50", location: null }],
        }),
      ]);
      expect(result.accepted[0]!.meetings).toEqual([]);
      expect(result.warnings.join(" ")).toContain("named no days");
    });

    it("sorts and de-duplicates days", () => {
      const result = run([
        course({
          meetings: [{ daysOfWeek: [5, 1, 3, 1], startTime: "09:00", endTime: "09:50", location: null }],
        }),
      ]);
      expect(result.accepted[0]!.meetings[0]!.daysOfWeek).toEqual([1, 3, 5]);
    });

    it("accepts a course with no meetings at all", () => {
      // Online and asynchronous classes are ordinary, and an empty list is the correct answer
      // rather than a reason to reject the class.
      const result = run([course({ meetings: [] })]);
      expect(result.accepted).toHaveLength(1);
      expect(result.warnings).toEqual([]);
    });

    it("keeps two meetings for one course, such as a lecture and a lab", () => {
      const result = run([
        course({
          meetings: [
            { daysOfWeek: [1, 3], startTime: "09:00", endTime: "09:50", location: "Hale 204" },
            { daysOfWeek: [5], startTime: "13:00", endTime: "15:45", location: "Lab 3" },
          ],
        }),
      ]);
      expect(result.accepted[0]!.meetings).toHaveLength(2);
    });
  });

  describe("duplicates", () => {
    it("keeps one course when the same class appears in two rows", () => {
      // Portal pages repeat courses across sections and views. Two courses with one code would
      // have a syllabus attach to whichever happened to come first.
      const result = run([course(), course()]);
      expect(result.accepted).toHaveLength(1);
      expect(result.rejected[0]?.reason).toContain("already read from another row");
    });

    it("does not confuse two different classes taught by the same instructor", () => {
      const other = course({
        code: "CCO202",
        name: "Christian Theology I",
        instructor: "Dr. Okafor",
        evidence: "CCO202   Christian Theology I               Dr. Okafor  TR 2:00-3:15pm    Hale 110",
        meetings: [{ daysOfWeek: [2, 4], startTime: "14:00", endTime: "15:15", location: "Hale 110" }],
      });
      expect(run([course(), other]).accepted).toHaveLength(2);
    });
  });

  it("passes through the lines the model could not read, rather than dropping them", () => {
    const result = validateCourseList(
      { courses: [course()], unreadableLines: ["ART101 -- see advisor"] },
      { pastedText: PASTED },
    );
    expect(result.unreadableLines).toEqual(["ART101 -- see advisor"]);
  });
});
