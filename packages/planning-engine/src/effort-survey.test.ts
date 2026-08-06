import { describe, expect, it } from "vitest";
import { INGESTED_SEMESTER } from "@schoolquest/fixtures";
import type { Course, GradingCategory, WorkItem } from "@schoolquest/domain";
import { applyEffortAnswer, buildEffortSurvey, humanMinutes } from "./effort-survey.js";

/**
 * The measurement this exists to move: of 61 ingested work items, 5 carry an effort estimate.
 * Everything else is planned against a per-type constant, so the survey's job is to turn 56
 * silent guesses into a handful of answerable questions.
 */

const SEMESTER = {
  workItems: INGESTED_SEMESTER.workItems,
  courses: INGESTED_SEMESTER.courses,
  gradingCategories: INGESTED_SEMESTER.gradingCategories,
};

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    courseId: "crs_1",
    parentWorkItemId: null,
    title: "Quiz 1",
    description: null,
    workType: "quiz",
    availableAt: null,
    dueAt: "2026-09-09T23:59:00.000Z",
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: null,
    remainingMinutes: null,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started",
    sourceConfidence: "high_inference",
    userPriority: 0,
    ...overrides,
  };
}

const COURSE: Course = {
  id: "crs_1",
  termId: "trm_1",
  name: "Introductory Biology",
  code: "BIO 240",
  instructor: null,
  credits: 4,
  colorToken: "slate",
  expectedWeeklyMinutes: null,
  targetGrade: null,
  gradingConfidence: "high_inference",
};

const CATEGORY: GradingCategory = {
  id: "gcat_1",
  courseId: "crs_1",
  name: "Quizzes",
  weightPercent: 20,
  dropRule: null,
  confidenceStatus: "high_inference",
};

describe("what the app is guessing about", () => {
  it("measures the real semester's grounding, and it is bad", () => {
    const survey = buildEffortSurvey(SEMESTER);
    console.log(
      `\nEFFORT GROUNDING  ${Math.round(survey.groundedFraction * 100)}% of remaining minutes ` +
        `rest on a real number\n` +
        `  ${survey.itemCount - survey.assumedItemCount} of ${survey.itemCount} open items estimated\n` +
        `  ${survey.questions.length} questions would settle all of it\n` +
        survey.questions
          .slice(0, 6)
          .map(
            (q, i) =>
              `  ${i + 1}. ${q.courseLabel.padEnd(8)} ${String(q.itemCount).padStart(2)}x ${q.workType.padEnd(12)} ` +
              `${humanMinutes(q.assumedMinutesTotal).padEnd(9)} ${Math.round(q.shareOfAssumed * 100)}% of the guessing` +
              (q.gradeSharePercent === null ? "" : `, ${q.gradeSharePercent}% of grade`),
          )
          .join("\n"),
    );

    // A floor, not an aspiration: this is where the term stands today.
    expect(survey.assumedItemCount).toBeGreaterThan(40);
    expect(survey.groundedFraction).toBeLessThan(0.2);
  });

  it("asks far fewer questions than there are items", () => {
    // The whole premise. If this ever approaches one question per item, the grouping has
    // stopped working and the screen has become the 61-field form it exists to avoid.
    const survey = buildEffortSurvey(SEMESTER);
    expect(survey.questions.length).toBeLessThan(survey.assumedItemCount / 3);
  });

  it("puts most of the term behind the first few questions", () => {
    // What makes the ask finishable: five answers, and the guessing is mostly gone.
    const survey = buildEffortSurvey(SEMESTER);
    const topFive = survey.questions.slice(0, 5).reduce((sum, q) => sum + q.shareOfAssumed, 0);
    expect(topFive).toBeGreaterThan(0.5);
  });

  it("orders by minutes at stake, biggest first", () => {
    const survey = buildEffortSurvey(SEMESTER);
    const totals = survey.questions.map((q) => q.assumedMinutesTotal);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it("gives the same survey twice", () => {
    // Reordering the screen under a student mid-answer is its own small betrayal.
    expect(buildEffortSurvey(SEMESTER)).toEqual(buildEffortSurvey(SEMESTER));
  });
});

describe("choosing what to ask", () => {
  it("groups a family of work into one question", () => {
    const survey = buildEffortSurvey({
      workItems: Array.from({ length: 13 }, (_, i) => item({ id: `wi_${i}`, title: `Quiz ${i + 1}` })),
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions).toHaveLength(1);
    expect(survey.questions[0]!.itemCount).toBe(13);
    expect(survey.questions[0]!.workItemIds).toHaveLength(13);
  });

  it("keeps different kinds of work apart even in the same course", () => {
    const survey = buildEffortSurvey({
      workItems: [
        item({ id: "a", workType: "quiz" }),
        item({ id: "b", workType: "lab", title: "Lab report" }),
      ],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions.map((q) => q.workType).sort()).toEqual(["lab", "quiz"]);
  });

  it("says nothing at all when every open item has a real estimate", () => {
    const survey = buildEffortSurvey({
      workItems: [item({ estimatedMinutes: 45, remainingMinutes: 45 })],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions).toEqual([]);
    expect(survey.groundedFraction).toBe(1);
  });

  it("does not ask about work that is finished or abandoned", () => {
    const survey = buildEffortSurvey({
      workItems: [
        item({ id: "a", status: "completed" }),
        item({ id: "b", status: "canceled" }),
        item({ id: "c", status: "not_started" }),
      ],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions).toHaveLength(1);
    expect(survey.questions[0]!.workItemIds).toEqual(["c"]);
  });

  it("does not ask about a project that is planned through its stages", () => {
    // Its own remaining is zeroed and its stages carry the hours. Asking would double it.
    const survey = buildEffortSurvey({
      workItems: [
        item({ id: "parent", workType: "paper", title: "Research Paper" }),
        item({ id: "stage", parentWorkItemId: "parent", workType: "milestone", estimatedMinutes: 60, remainingMinutes: 60 }),
      ],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions).toEqual([]);
  });
});

describe("how the question reads", () => {
  it("shows the current assumption as one of the choices", () => {
    // So the student can see what they are correcting, and can leave it alone knowingly.
    const survey = buildEffortSurvey({
      workItems: [item({ workType: "problem_set" })],
      courses: [COURSE],
      gradingCategories: [],
    });
    const options = survey.questions[0]!.options;
    const current = options.filter((o) => o.isCurrentAssumption);
    expect(current).toHaveLength(1);
    expect(current[0]!.minutes).toBe(90); // the problem_set default
  });

  it("offers choices that are plausible for the kind of work", () => {
    // A quiz should not offer "a weekend"; a paper should not stop at 45 minutes.
    const quiz = buildEffortSurvey({
      workItems: [item({ workType: "quiz" })],
      courses: [COURSE],
      gradingCategories: [],
    }).questions[0]!;
    const paper = buildEffortSurvey({
      workItems: [item({ id: "p", workType: "paper", title: "Term paper" })],
      courses: [COURSE],
      gradingCategories: [],
    }).questions[0]!;

    expect(Math.max(...quiz.options.map((o) => o.minutes))).toBeLessThanOrEqual(180);
    expect(Math.max(...paper.options.map((o) => o.minutes))).toBeGreaterThanOrEqual(480);
  });

  it("always offers a full set of choices, even at the ends of the ladder", () => {
    for (const workType of ["discussion", "paper", "quiz", "group_project", "reading"]) {
      const survey = buildEffortSurvey({
        workItems: [item({ workType: workType as WorkItem["workType"] })],
        courses: [COURSE],
        gradingCategories: [],
      });
      const options = survey.questions[0]!.options;
      // Six rungs of the ladder, plus "no time needed", which is offered on every question.
      expect(options).toHaveLength(7);
      expect(options.filter((o) => o.minutes > 0)).toHaveLength(6);
      expect(options[options.length - 1]!.minutes).toBe(0);
    }
  });

  it("offers 'no time needed' as a real answer, last and never preselected", () => {
    /**
     * The standing goal has an escape hatch — "realistic time allotted to each *unless the
     * student says time isn't needed*" — and until now there was no way to say it. Some graded
     * work genuinely costs nothing to plan for: an attendance mark, a participation grade, an
     * in-class quiz nobody revises for.
     *
     * Last on the list and never the current assumption, because it should be a deliberate
     * choice rather than the easiest way out of a question. It is also not the same as "I don't
     * know", which leaves the guess standing and drafts a question for the instructor.
     */
    const survey = buildEffortSurvey({
      workItems: [item({ workType: "discussion" })],
      courses: [COURSE],
      gradingCategories: [],
    });
    const zero = survey.questions[0]!.options.find((o) => o.minutes === 0)!;
    expect(zero.isCurrentAssumption).toBe(false);
    expect(zero.label).toContain("no time needed");
  });

  it("counts work the student excused as settled, not as still-unknown", () => {
    // Answering "no time needed" has to stop the question coming back, or the escape hatch is
    // a loop. Zero is a number somebody gave us; null is the absence of one.
    const answered = item({ estimatedMinutes: 0, remainingMinutes: 0 });
    const survey = buildEffortSurvey({
      workItems: [answered],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions).toEqual([]);
    expect(survey.assumedItemCount).toBe(0);
    expect(survey.groundedFraction).toBe(1);
  });

  it("counts a shared grading category once, not once per item", () => {
    // Thirteen quizzes worth 20% between them are 20% of the grade.
    const survey = buildEffortSurvey({
      workItems: Array.from({ length: 13 }, (_, i) =>
        item({ id: `wi_${i}`, gradingCategoryId: "gcat_1" }),
      ),
      courses: [COURSE],
      gradingCategories: [CATEGORY],
    });
    expect(survey.questions[0]!.gradeSharePercent).toBe(20);
    expect(survey.questions[0]!.stakes).toContain("20% of your BIO 240 grade");
  });

  it("says nothing about weight when the syllabus never gave one", () => {
    const survey = buildEffortSurvey({
      workItems: [item()],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions[0]!.gradeSharePercent).toBeNull();
    expect(survey.questions[0]!.stakes).not.toContain("%");
  });

  it("writes a question the student can send the professor as it stands", () => {
    const survey = buildEffortSurvey({
      workItems: [item({ id: "a", workType: "lab", title: "Formal Lab Report" })],
      courses: [COURSE],
      gradingCategories: [],
    });
    const ask = survey.questions[0]!.askProfessor;
    expect(ask).toContain("Formal Lab Report");
    expect(ask.startsWith("Hi")).toBe(true);
    // No placeholders left in it: a message with a [BLANK] is a message nobody sends.
    expect(ask).not.toMatch(/\[|\{|undefined|null/);
  });

  it("names the family in the plural and the one-off by its title", () => {
    const many = buildEffortSurvey({
      workItems: [item({ id: "a" }), item({ id: "b" })],
      courses: [COURSE],
      gradingCategories: [],
    }).questions[0]!;
    const one = buildEffortSurvey({
      workItems: [item({ id: "c", workType: "exam", title: "Midterm" })],
      courses: [COURSE],
      gradingCategories: [],
    }).questions[0]!;

    expect(many.question).toContain("quizzes");
    expect(one.question).toContain("Midterm");
  });
});

describe("applying an answer", () => {
  const items = Array.from({ length: 3 }, (_, i) => item({ id: `wi_${i}` }));
  const survey = buildEffortSurvey({ workItems: items, courses: [COURSE], gradingCategories: [] });

  it("sets every item in the family from one answer", () => {
    const writes = applyEffortAnswer(survey.questions[0]!, 45, items);
    expect(writes).toHaveLength(3);
    for (const w of writes) {
      expect(w.estimatedMinutes).toBe(45);
      expect(w.remainingMinutes).toBe(45);
    }
  });

  it("touches nothing outside the family", () => {
    const other = item({ id: "elsewhere", courseId: "crs_2" });
    const writes = applyEffortAnswer(survey.questions[0]!, 45, [...items, other]);
    expect(writes.map((w) => w.workItemId)).not.toContain("elsewhere");
  });

  it("leaves work already under way with the minutes it still owes", () => {
    // The answer is about how big the job is, not about what is left of this particular one.
    const started = [item({ id: "wi_0", status: "in_progress", remainingMinutes: 20 })];
    const only = buildEffortSurvey({
      workItems: started,
      courses: [COURSE],
      gradingCategories: [],
    });
    // It has a remaining, so it is not assumed and is not asked about at all.
    expect(only.questions).toEqual([]);
  });
});

describe("saying durations the way a person would", () => {
  it("never says '240 min'", () => {
    expect(humanMinutes(30)).toBe("30 minutes");
    expect(humanMinutes(60)).toBe("1 hour");
    expect(humanMinutes(90)).toBe("1 hour 30 minutes");
    expect(humanMinutes(240)).toBe("4 hours");
    expect(humanMinutes(390)).toBe("6 hours 30 minutes");
  });
});

describe("work you sit rather than do", () => {
  it("asks about preparation for an exam, not about the exam", () => {
    // "How long does one of MAT 205's exams take you?" gets the honest, useless answer
    // "fifty minutes, it's in class". The scheduler is placing revision blocks.
    const survey = buildEffortSurvey({
      workItems: [
        item({ id: "a", workType: "exam", title: "Midterm" }),
        item({ id: "b", workType: "exam", title: "Final Exam" }),
      ],
      courses: [COURSE],
      gradingCategories: [],
    });
    const q = survey.questions[0]!;
    expect(q.question).toContain("get ready");
    expect(q.stakes).toContain("revising");
    expect(q.askProfessor).toContain("preparation");
  });

  it("asks about a quiz the same way", () => {
    const survey = buildEffortSurvey({
      workItems: [item({ workType: "quiz" })],
      courses: [COURSE],
      gradingCategories: [],
    });
    expect(survey.questions[0]!.question).toContain("get ready");
  });

  it("still asks plainly about work that is actually done", () => {
    for (const workType of ["paper", "problem_set", "lab", "reading"] as const) {
      const q = buildEffortSurvey({
        workItems: [item({ id: workType, workType, title: "Thing" })],
        courses: [COURSE],
        gradingCategories: [],
      }).questions[0]!;
      expect(q.question).not.toContain("get ready");
      expect(q.stakes).not.toContain("revising");
    }
  });
});
