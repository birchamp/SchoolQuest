import { describe, expect, it } from "vitest";

import { setupProgress, type SetupFacts, type SetupStepId } from "./setup-progress";

const NOTHING: SetupFacts = {
  providerConfigured: false,
  calendarEntries: 0,
  courseCount: 0,
  coursesWithMeetings: 0,
};

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ ...NOTHING, ...over });
const step = (f: SetupFacts, id: SetupStepId) => setupProgress(f).steps.find((s) => s.id === id)!;

const KEY_ONLY = facts({ providerConfigured: true });
const KEY_AND_CALENDAR = facts({ providerConfigured: true, calendarEntries: 6 });
const READY = facts({ providerConfigured: true, calendarEntries: 6, courseCount: 4 });

describe("setupProgress", () => {
  it("asks for the key first, since everything after it fails without one", () => {
    expect(setupProgress(NOTHING).currentId).toBe("provider");
  });

  it("moves to the calendar once a key exists", () => {
    expect(setupProgress(KEY_ONLY).currentId).toBe("calendar");
  });

  it("moves to courses once the calendar exists", () => {
    expect(setupProgress(KEY_AND_CALENDAR).currentId).toBe("courses");
  });

  describe("the order that matters", () => {
    it("locks the calendar behind the key, because pasting one reads it with the model", () => {
      expect(step(NOTHING, "calendar")).toMatchObject({ unlocked: false, blockedBy: "provider" });
    });

    it("locks courses behind the calendar", () => {
      // The hard rule, reached through the offered path: adding a course means uploading its
      // syllabus, and a syllabus read against an empty calendar produces confident wrong dates
      // rather than a visible failure.
      expect(step(KEY_ONLY, "courses")).toMatchObject({ unlocked: false, blockedBy: "calendar" });
    });

    it("locks meeting times behind having a course to have times for", () => {
      expect(step(KEY_AND_CALENDAR, "meetings")).toMatchObject({
        unlocked: false,
        blockedBy: "courses",
      });
    });

    it("never puts a step in front of the student that they cannot finish", () => {
      // The property behind the cases above, over every combination of the four facts.
      for (const providerConfigured of [false, true])
        for (const calendarEntries of [0, 4])
          for (const courseCount of [0, 2])
            for (const coursesWithMeetings of [0, 1, 2]) {
              const f = { providerConfigured, calendarEntries, courseCount, coursesWithMeetings };
              const progress = setupProgress(f);
              const current = progress.steps.find((s) => s.id === progress.currentId)!;
              expect(current.unlocked || progress.steps.every((s) => s.done)).toBe(true);
            }
    });
  });

  describe("courses are not hand entry", () => {
    it("counts courses however they arrived, so a syllabus can satisfy the step", () => {
      // The point of the change: the extraction reads the course name and code off page one, so
      // requiring them to be typed first made hand entry a prerequisite for removing hand entry.
      expect(step(facts({ ...KEY_AND_CALENDAR, courseCount: 1 }), "courses").done).toBe(true);
    });
  });

  describe("meeting times", () => {
    it("is not done while any course is still missing them", () => {
      // Three of four classes having times is exactly the case worth still asking about.
      const partly = facts({ ...READY, coursesWithMeetings: 3 });
      expect(step(partly, "meetings").done).toBe(false);
    });

    it("is done when every course has them", () => {
      expect(step(facts({ ...READY, coursesWithMeetings: 4 }), "meetings").done).toBe(true);
    });

    it("is optional, so a syllabus that never stated times does not block the app", () => {
      expect(step(READY, "meetings").required).toBe(false);
      expect(setupProgress(READY).ready).toBe(true);
    });
  });

  describe("readiness", () => {
    it("is not ready while any required step is outstanding", () => {
      expect(setupProgress(KEY_ONLY).ready).toBe(false);
      expect(setupProgress(KEY_AND_CALENDAR).ready).toBe(false);
    });

    it("is ready on key, calendar and at least one course", () => {
      expect(setupProgress(READY).ready).toBe(true);
    });

    it("still points at meeting times once the required steps are done", () => {
      expect(setupProgress(READY).currentId).toBe("meetings");
    });
  });

  describe("progress counting", () => {
    it("counts required steps only, so the bar can actually fill", () => {
      expect(setupProgress(READY)).toMatchObject({ doneCount: 3, totalCount: 3 });
    });

    it("counts partial progress", () => {
      expect(setupProgress(KEY_ONLY).doneCount).toBe(1);
      expect(setupProgress(NOTHING).doneCount).toBe(0);
    });
  });

  describe("resuming", () => {
    it("skips what is already done rather than restarting", () => {
      // Someone who set a key and a calendar should be asked for courses, not walked through it
      // all again. The guide is resumable because every step reads live state.
      expect(setupProgress(KEY_AND_CALENDAR).currentId).toBe("courses");
      expect(step(KEY_AND_CALENDAR, "provider").done).toBe(true);
      expect(step(KEY_AND_CALENDAR, "calendar").done).toBe(true);
    });

    it("reports every step done when the term is fully set up", () => {
      const all = facts({ ...READY, coursesWithMeetings: 4 });
      expect(setupProgress(all).steps.every((s) => s.done)).toBe(true);
      expect(setupProgress(all).ready).toBe(true);
    });
  });
});
