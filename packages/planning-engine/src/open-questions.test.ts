import { describe, expect, it } from "vitest";
import type { Course, GradingCategory, WorkItem } from "@schoolquest/domain";
import { INGESTED_SEMESTER } from "@schoolquest/fixtures";
import { buildOpenQuestions } from "./open-questions.js";

/**
 * What the app still does not know about a real ingested term, and whether it says so.
 *
 * Driven by `INGESTED_SEMESTER` — five courses dumped straight out of the Worker after a full
 * ingest — rather than a hand-built case, because the whole question here is "on a term that
 * actually went through the pipeline, how much is left open?" A fixture written to have three
 * gaps would answer a question nobody asked.
 */

const COURSES = INGESTED_SEMESTER.courses as Course[];
const ITEMS = INGESTED_SEMESTER.workItems as WorkItem[];
const CATEGORIES = INGESTED_SEMESTER.gradingCategories as GradingCategory[];

describe("open questions on the ingested term", () => {
  it("finds every undated item and asks one question per course about them", () => {
    const result = buildOpenQuestions({
      courses: COURSES,
      workItems: ITEMS,
      gradingCategories: CATEGORIES,
    });

    const undated = ITEMS.filter(
      (w) => w.dueAt === null && !["completed", "submitted", "canceled"].includes(w.status),
    );
    const asked = result.courses.flatMap((c) => c.questions.filter((q) => q.kind === "missing_due_date"));

    console.log(
      `\nOPEN QUESTIONS  ${result.questionCount} across ${result.coursesAffected} of ${COURSES.length} courses` +
        `\n   undated items ${undated.length}, gathered into ${asked.length} question(s)` +
        result.courses
          .map((c) => `\n   ${c.courseLabel}: ${c.questions.map((q) => q.kind).join(", ")}`)
          .join(""),
    );

    // Every undated item is named by exactly one question, and none is named twice.
    const named = asked.flatMap((q) => q.workItemIds);
    expect(new Set(named).size).toBe(named.length);
    expect(new Set(named)).toEqual(new Set(undated.map((w) => w.id)));

    // Grouped per course, not per item: eight undated items must not become eight emails.
    expect(asked.length).toBeLessThan(undated.length);
  });

  it("writes a message per course that names every one of its questions", () => {
    const result = buildOpenQuestions({
      courses: COURSES,
      workItems: ITEMS,
      gradingCategories: CATEGORIES,
      policies: [
        {
          id: "clm_policy",
          courseId: COURSES[0]!.id,
          kind: "late_work",
          summary: "Late assignments lose 10% per day.",
        },
      ],
    });

    for (const course of result.courses) {
      expect(course.draftMessage, course.courseLabel).not.toBe("");
      // The draft is the deliverable: if a question is not in it, the student has to compose,
      // and composing is the step this exists to remove.
      for (const question of course.questions) {
        expect(course.draftMessage, `${course.courseLabel}: ${question.id}`).toContain(
          question.askProfessor,
        );
      }
      // Addressed to the instructor when the syllabus named one.
      const instructor = COURSES.find((c) => c.id === course.courseId)!.instructor;
      if (instructor) expect(course.draftMessage).toContain(`Dear ${instructor},`);
    }

    console.log(`\nDRAFT for ${result.courses[0]!.courseLabel}:\n${result.courses[0]!.draftMessage}`);
  });

  it("says nothing about a course that has no gaps", () => {
    /**
     * The state this screen is trying to reach: a course with dates, complete weights and no
     * pending questions is absent from the list entirely rather than present and empty.
     *
     * Built rather than taken from the fixture, because no course in the fixture qualifies —
     * writing this test is what turned up that BIO 240's stated weights add up to 90%, which
     * nothing had ever told the student.
     */
    const course = { ...COURSES[0]!, id: "crs_complete" };
    const result = buildOpenQuestions({
      courses: [course],
      workItems: ITEMS.filter((w) => w.dueAt !== null).map((w) => ({ ...w, courseId: course.id })),
      gradingCategories: [
        {
          id: "gcat_all",
          courseId: course.id,
          name: "Everything",
          weightPercent: 100,
          dropRule: null,
          confidenceStatus: "confirmed" as const,
        },
      ],
    });
    expect(result.courses).toEqual([]);
    expect(result.questionCount).toBe(0);
  });

  it("names the course whose weights fall short, because nothing else does", () => {
    // Found by this file on its first run. BIO 240's four categories are all weighted and they
    // total 90%; the missing tenth is work the student has been told nothing about.
    const result = buildOpenQuestions({
      courses: COURSES,
      workItems: [],
      gradingCategories: CATEGORIES,
    });
    const short = result.courses.flatMap((c) =>
      c.questions.filter((q) => q.kind === "weights_incomplete").map((q) => [c.courseLabel, q.question]),
    );
    console.log(`\nWEIGHTS SHORT OF 100:${short.map(([l, q]) => `\n   ${l} — ${q}`).join("") || " none"}`);
    expect(short.length).toBeGreaterThan(0);
  });
});

describe("the grading questions, which are two different faults", () => {
  const course = { ...COURSES[0]!, id: "crs_x", instructor: "Dr Vale" };
  const cat = (name: string, weightPercent: number | null): GradingCategory => ({
    id: `gcat_${name}`,
    courseId: "crs_x",
    name,
    weightPercent,
    dropRule: null,
    confidenceStatus: "high_inference",
  });
  const build = (categories: GradingCategory[]) =>
    buildOpenQuestions({ courses: [course], workItems: [], gradingCategories: categories });

  it("asks what an unweighted category is worth", () => {
    const questions = build([cat("Exams", 60), cat("Participation", null)]).courses[0]!.questions;
    expect(questions.map((q) => q.kind)).toEqual(["unknown_weight"]);
    expect(questions[0]!.askProfessor).toContain("Participation");
  });

  it("asks what makes up the rest when the weights fall short", () => {
    const questions = build([cat("Exams", 60), cat("Homework", 25)]).courses[0]!.questions;
    expect(questions.map((q) => q.kind)).toEqual(["weights_incomplete"]);
    expect(questions[0]!.askProfessor).toContain("15%");
  });

  it("does not ask twice about the same course", () => {
    // An unweighted category makes the sum meaningless, so asking "what is X worth" and "what
    // makes up the other 40%" of the same course is one confusing question, not two.
    const questions = build([cat("Exams", 60), cat("Participation", null)]).courses[0]!.questions;
    expect(questions).toHaveLength(1);
  });

  it("stays quiet at 99%, because syllabi round", () => {
    expect(build([cat("Exams", 60), cat("Homework", 39)]).courses).toEqual([]);
  });

  it("stays quiet when the weights are complete", () => {
    expect(build([cat("Exams", 60), cat("Homework", 40)]).courses).toEqual([]);
  });
});

describe("what belongs in an email and what does not", () => {
  const course = { ...COURSES[0]!, id: "crs_s", instructor: "Dr Vale" };
  const build = (clarifications: Parameters<typeof buildOpenQuestions>[0]["clarifications"]) =>
    buildOpenQuestions({ courses: [course], workItems: [], gradingCategories: [], clarifications });

  const clarify = (question: string, relatesToTitles: string[] = []) => ({
    id: `clm_${question.length}_${relatesToTitles.join("")}`,
    courseId: "crs_s",
    question,
    why: "It changes the plan.",
    relatesToTitles,
  });

  it("keeps a question whose subject is only visible on screen out of the draft", () => {
    /**
     * Found by reading the real output. Among nine pending clarifications on the test term,
     * eight were good questions for an instructor and one was this — aimed at the review
     * screen, and unanswerable by anyone who cannot see it. It went into the draft anyway.
     */
    const result = build([clarify("Do these grading categories and weights look right?")]);
    const question = result.courses[0]!.questions[0]!;
    expect(question.sendable).toBe(false);
    expect(question.askProfessor).toBe("");
    // Still shown — the student can settle it in review. Just not sent.
    expect(question.question).toContain("look right");
    expect(result.courses[0]!.draftMessage).toBe("");
  });

  it("sends a question that names the work it is about", () => {
    const question = build([clarify("Which date is right?", ["Research Paper"])]).courses[0]!
      .questions[0]!;
    expect(question.sendable).toBe(true);
    expect(question.askProfessor).toContain("Which date is right?");
  });

  it("sends a question that points at the document, even without a named assignment", () => {
    // The real one this saves: "Your grading section says reading quizzes are given every
    // Friday, but the course schedule only lists Tuesday and Thursday." Names no work item,
    // and is one of the best questions in the set.
    const question = build([
      clarify("Your grading section says quizzes are Friday, but the schedule lists Tuesday."),
    ]).courses[0]!.questions[0]!;
    expect(question.sendable).toBe(true);
  });

  it("writes a draft from the sendable ones only", () => {
    const result = build([
      clarify("Do these look right?"),
      clarify("When is it due?", ["Final Portfolio"]),
    ]);
    const draft = result.courses[0]!.draftMessage;
    expect(draft).toContain("When is it due?");
    expect(draft).not.toContain("Do these look right?");
    // Both are still on the list; only one is in the message.
    expect(result.courses[0]!.questions).toHaveLength(2);
  });
});

describe("a question an instructor can actually answer", () => {
  const course = { ...COURSES[0]!, id: "crs_n", instructor: "Dr Vale" };
  const one = (question: string, relatesToTitles: string[]) =>
    buildOpenQuestions({
      courses: [course],
      workItems: [],
      gradingCategories: [],
      clarifications: [{ id: "clm_1", courseId: "crs_n", question, why: "", relatesToTitles }],
    }).courses[0]!.questions[0]!;

  it("names the work when the question does not name it itself", () => {
    /**
     * Read off the real screen. BIO 240's draft carried "3 items have dates that contradict the
     * rest of the syllabus. Which is right?" — unanswerable by anyone, because the three items
     * were named in the explanation the student sees and nowhere in the sentence being sent.
     */
    const q = one("3 items have dates that contradict the syllabus. Which is right?", [
      "Midterm Exam",
      "Final Exam",
    ]);
    expect(q.askProfessor).toContain("Midterm Exam and Final Exam");
  });

  it("does not repeat a title the question already contains", () => {
    const q = one('"Research Paper" is listed with two dates. Which is right?', ["Research Paper"]);
    expect(q.askProfessor).not.toMatch(/This is about/);
  });

  it("does not list the same title twice", () => {
    // The real claim listed "Midterm Exam, Final Exam, Midterm Exam", which reads as
    // carelessness in a message to a professor.
    const q = one("Which dates are right?", ["Midterm Exam", "Final Exam", "Midterm Exam"]);
    expect(q.askProfessor).toContain("Midterm Exam and Final Exam");
    expect(q.askProfessor.match(/Midterm Exam/g)).toHaveLength(1);
  });
});
