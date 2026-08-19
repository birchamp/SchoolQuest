import { describe, expect, it } from "vitest";

import { courseGauges, type CourseSetupFacts } from "./course-gauges.js";
import type { CourseHealth } from "./course-health.js";

const health = (over: Partial<CourseHealth> = {}): CourseHealth => ({
  courseId: "crs_1",
  level: "steady",
  concerns: [],
  bookedMinutes: 120,
  blocks: 3,
  openItems: 3,
  nextDueAt: null,
  nextDueTitle: null,
  nextDueInDays: null,
  gradePercent: 88,
  gradedWeightFraction: 0.5,
  gradedCount: 6,
  targetPercent: 80,
  targetIsOwn: false,
  ungradedResults: 0,
  ...over,
});

const facts = (over: Partial<CourseSetupFacts> = {}): CourseSetupFacts => ({
  courseId: "crs_1",
  hasSyllabus: true,
  hasMeetingTimes: true,
  gradingKnown: true,
  workItemCount: 20,
  ...over,
});

const run = (h = health(), f = facts(), calendarEntries = 8) =>
  courseGauges({ health: [h], setup: [f], calendarEntries })[0]!;

describe("courseGauges", () => {
  it("reads a healthy class as good on every dial", () => {
    const { gauges, nextStep } = run();
    expect(gauges.setup.level).toBe("good");
    expect(gauges.grade.level).toBe("good");
    expect(gauges.planning.level).toBe("good");
    expect(gauges.overall.level).toBe("good");
    expect(nextStep).toBeNull();
  });

  describe("setup", () => {
    it("is bad without a syllabus, and says the class is empty when it has no work", () => {
      const g = run(health({ openItems: 0 }), facts({ hasSyllabus: false, workItemCount: 0 }));
      expect(g.gauges.setup.level).toBe("bad");
      expect(g.gauges.setup.detail).toContain("empty");
    });

    it("blames the calendar, not the student, when the calendar is what is blocking", () => {
      // Upload is deliberately disabled until the calendar exists, so "upload a syllabus" would
      // send someone to a control that refuses them.
      const g = run(health(), facts({ hasSyllabus: false }), 0);
      expect(g.gauges.setup.detail).toContain("semester calendar");
      expect(g.nextStep).toEqual({
        label: "Fill in the semester calendar",
        target: "setup:calendar",
      });
    });

    it("treats unstated grading and times as watch, not bad", () => {
      // A syllabus that never printed them is a fact about the syllabus. The class still works.
      const g = run(health(), facts({ gradingKnown: false, hasMeetingTimes: false }));
      expect(g.gauges.setup.level).toBe("watch");
      expect(g.gauges.setup.detail).toContain("how it is graded");
      expect(g.gauges.setup.detail).toContain("when it meets");
    });

    it("weights a missing syllabus more heavily than missing meeting times", () => {
      const noSyllabus = run(health(), facts({ hasSyllabus: false })).gauges.setup.value!;
      const noTimes = run(health(), facts({ hasMeetingTimes: false })).gauges.setup.value!;
      expect(noSyllabus).toBeLessThan(noTimes);
    });
  });

  describe("grade", () => {
    it("refuses a verdict while too little of the course is graded", () => {
      // Two quizzes in, 100% and 60% are both mostly noise. A dial that calls one excellent and
      // the other failing invites relaxing or panicking over four points.
      const g = run(health({ gradePercent: 100, gradedWeightFraction: 0.05 }));
      expect(g.gauges.grade.level).toBe("unknown");
      expect(g.gauges.grade.detail).toContain("5% of the course has been graded");
      // The dial still shows the number; it just does not pass judgement on it.
      expect(g.gauges.grade.value).toBeCloseTo(1);
    });

    it("is bad when the standing is clearly below target", () => {
      const g = run(health({ gradePercent: 68, targetPercent: 80, targetIsOwn: true }));
      expect(g.gauges.grade.level).toBe("bad");
      expect(g.gauges.grade.detail).toContain("you set");
    });

    it("is watch when it is only just under", () => {
      expect(run(health({ gradePercent: 78, targetPercent: 80 })).gauges.grade.level).toBe("watch");
    });

    it("is unknown, not zero, when nothing has been graded", () => {
      // "Nothing recorded" and "nothing achieved" are different sentences, and a dial at zero
      // says the second one.
      const g = run(health({ gradePercent: null, gradedWeightFraction: 0 }));
      expect(g.gauges.grade.value).toBeNull();
      expect(g.gauges.grade.level).toBe("unknown");
    });

    it("names results that came back and were never recorded", () => {
      const g = run(health({ gradePercent: null, ungradedResults: 3 }));
      expect(g.gauges.grade.detail).toContain("3 finished items have no result");
    });
  });

  describe("planning", () => {
    it("caps coverage at one block per open item", () => {
      // Six blocks against two items is not three times as ready.
      expect(run(health({ blocks: 6, openItems: 2 })).gauges.planning.value).toBe(1);
    });

    it("is good with nothing open", () => {
      const g = run(health({ openItems: 0, blocks: 0 }));
      expect(g.gauges.planning).toMatchObject({ level: "good", value: 1 });
    });

    it("carries the engine's own sentence when it has raised a concern", () => {
      const g = run(
        health({
          blocks: 0,
          concerns: [
            { code: "UNPLANNED_WEEK", level: "at_risk", detail: "Three things due and no time booked." },
          ],
        }),
      );
      expect(g.gauges.planning.level).toBe("bad");
      expect(g.gauges.planning.detail).toBe("Three things due and no time booked.");
    });

    it("mentions an imminent deadline when nothing is booked", () => {
      const g = run(health({ blocks: 0, nextDueInDays: 2 }));
      expect(g.gauges.planning.detail).toContain("due in 2 days");
    });
  });

  describe("overall", () => {
    it("takes the worst dial, never the average of them", () => {
      // Set up perfectly and graded well, with nothing booked the week three deadlines land, is
      // not "mostly fine" -- averaging is how the one dial that matters gets hidden.
      const g = run(
        health({
          blocks: 0,
          concerns: [
            { code: "DEADLINE_UNPREPARED", level: "at_risk", detail: "Due Friday, nothing booked." },
          ],
        }),
      );
      expect(g.gauges.setup.level).toBe("good");
      expect(g.gauges.grade.level).toBe("good");
      expect(g.gauges.overall.level).toBe("bad");
    });

    it("reports the worst dial's own value, so the number and the colour agree", () => {
      /**
       * Read off the rendered board. Averaging gave a class 90 in amber -- the number was a mean
       * and the colour was the worst, two different aggregations in one dial, each contradicting
       * the other. A student reading 90 beside amber has to work out which half to believe.
       */
      const g = run(health({ blocks: 0, openItems: 4 }), facts({ gradingKnown: false }));
      const known = [g.gauges.setup, g.gauges.grade, g.gauges.planning]
        .map((x) => x.value)
        .filter((v): v is number => v !== null);
      expect(g.gauges.overall.value).toBe(Math.min(...known));
    });

    it("folds in the health engine's own verdict, which sees more than these three", () => {
      const g = run(health({ level: "at_risk" }));
      expect(g.gauges.overall.level).toBe("bad");
    });

    it("repeats the sentence from whichever dial set it, rather than inventing one", () => {
      const g = run(health({ gradePercent: 55, targetPercent: 80 }));
      expect(g.gauges.overall.detail).toBe(g.gauges.grade.detail);
    });
  });

  describe("the next step", () => {
    it("offers exactly one thing, even when several are wrong", () => {
      // A class with four problems still has one thing to do first, and offering four is how a
      // student does none of them.
      const g = run(
        health({ gradePercent: 50, blocks: 0, concerns: [] }),
        facts({ hasSyllabus: false, gradingKnown: false, hasMeetingTimes: false, workItemCount: 0 }),
      );
      expect(g.nextStep).not.toBeNull();
      expect(Object.keys(g.nextStep!)).toEqual(["label", "target"]);
    });

    it("puts setup ahead of the numbers drawn from an incomplete record", () => {
      const g = run(health({ gradePercent: 50, targetPercent: 80 }), facts({ hasSyllabus: false }));
      expect(g.nextStep?.target).toBe("setup:syllabus");
    });

    it("sends a badly planned week to the week, not to setup", () => {
      const g = run(
        health({
          blocks: 0,
          concerns: [{ code: "UNPLANNED_WEEK", level: "at_risk", detail: "Nothing booked." }],
        }),
      );
      expect(g.nextStep?.target).toBe("week");
    });

    it("stays silent when nothing needs doing", () => {
      expect(run().nextStep).toBeNull();
    });
  });

  describe("every non-green dial is its own door", () => {
    it("gives each troubled dial an action, and leaves green and empty dials none", () => {
      const g = run(
        health({
          gradePercent: 60,
          targetPercent: 80,
          gradedWeightFraction: 0.5,
          blocks: 0,
          openItems: 3,
          concerns: [{ code: "UNPLANNED_WEEK", level: "at_risk", detail: "Nothing booked." }],
        }),
        facts(),
      );
      // Setup is fully done here, so its dial is green and inert.
      expect(g.gauges.setup.level).toBe("good");
      expect(g.gauges.setup.action).toBeNull();
      // Grade below target and planning unbooked both point somewhere.
      expect(g.gauges.grade.action?.target).toBe("week");
      expect(g.gauges.planning.action?.target).toBe("week");
    });

    it("sends an ungraded-results grade dial to the assignments table, not the week", () => {
      const g = run(health({ gradePercent: null, ungradedResults: 2 }));
      expect(g.gauges.grade.level).toBe("unknown");
      expect(g.gauges.grade.action).toEqual({ label: "Record the results", target: "work" });
    });

    it("makes the overall dial a link to the same place as the ranked next step", () => {
      const g = run(
        health({
          gradePercent: 55,
          targetPercent: 80,
          gradedWeightFraction: 0.6,
          blocks: 2,
          openItems: 2,
        }),
      );
      expect(g.gauges.overall.action).toEqual(g.nextStep);
      expect(g.gauges.overall.action).not.toBeNull();
    });

    it("gives the overall dial no door when the class is fine", () => {
      const g = run();
      expect(g.gauges.overall.level).toBe("good");
      expect(g.gauges.overall.action).toBeNull();
    });

    it("routes the calendar block through the setup dial itself", () => {
      const g = run(health(), facts({ hasSyllabus: false }), 0);
      expect(g.gauges.setup.action).toEqual({
        label: "Fill in the semester calendar",
        target: "setup:calendar",
      });
    });
  });

  it("treats a class with no setup record as having none, rather than failing", () => {
    // Readiness and health are separate reads and can disagree for a moment after a change.
    const [only] = courseGauges({ health: [health()], setup: [], calendarEntries: 4 });
    expect(only!.gauges.setup.level).toBe("bad");
  });
});
