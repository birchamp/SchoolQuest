// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "@schoolquest/domain";
import { Stats } from "./Stats";
import type { CourseProgressView, ProjectsSummaryView, TermProgressView } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_PROJECTS: { rows: []; summary: ProjectsSummaryView } = {
  rows: [],
  summary: {
    investedMinutes: 0,
    sessionsCompleted: 0,
    bookedMinutes: 0,
    projectsTotal: 0,
    projectsFinished: 0,
    projectsWillNotFit: 0,
    projectsCrowding: 0,
    projectsNotStarted: 0,
    projectsStalled: 0,
    projectsPastDue: 0,
  },
};

const course = (id: string, name: string): Course =>
  ({ id, code: null, name, colorToken: null }) as unknown as Course;

const cp = (over: Partial<CourseProgressView>): CourseProgressView => ({
  courseId: "a",
  itemsTotal: 10,
  itemsDone: 4,
  pointsTotal: 200,
  pointsDone: 80,
  pointsCoverage: 1,
  completionFraction: 0.4,
  basis: "points",
  ...over,
});

const term = (courses: CourseProgressView[], basis: "points" | "items" = "points"): TermProgressView => ({
  courses,
  itemsTotal: courses.reduce((n, c) => n + c.itemsTotal, 0),
  itemsDone: courses.reduce((n, c) => n + c.itemsDone, 0),
  pointsTotal: 0,
  pointsDone: 0,
  pointsCoverage: 1,
  completionFraction: 0.4,
  basis,
  effortMinutes: 0,
  sessionsCompleted: 0,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(progress: TermProgressView, courses: Course[]) {
  act(() =>
    root.render(<Stats projects={NO_PROJECTS} progress={progress} courses={courses} standings={{}} />),
  );
}

const coursesCard = () => host.querySelector("section[aria-labelledby='stats-courses-heading']")!;
const row = (name: string) =>
  [...coursesCard().querySelectorAll("li")].find((li) => li.textContent?.includes(name))!;

describe("Stats: per-course term progress (moved from the week's Questline)", () => {
  it("prints no points figure on a course counted by task", () => {
    render(
      term([
        cp({ courseId: "a" }),
        cp({ courseId: "b", basis: "items", pointsTotal: 0, pointsDone: 0, pointsCoverage: 0 }),
      ]),
      [course("a", "Art"), course("b", "Biology")],
    );
    expect(row("Art").textContent).toContain("80 of 200 points");
    expect(row("Biology").textContent).toContain("4 of 10 tasks done");
    expect(row("Biology").textContent).not.toMatch(/points/);
    // Mixed bases: why some rows have no points is said once, on the card.
    expect(coursesCard().textContent).toContain("Counted by task where a syllabus states grading weights");
  });

  it("explains mixed bases on the course rows even when the term as a whole counts by task", () => {
    render(
      term(
        [
          cp({ courseId: "a" }),
          cp({ courseId: "b", basis: "items", pointsTotal: 0, pointsDone: 0, pointsCoverage: 0 }),
        ],
        "items",
      ),
      [course("a", "Art"), course("b", "Biology")],
    );
    expect(coursesCard().textContent).toContain("Counted by task where a syllabus states grading weights");
  });

  it("says nothing about mixed bases when every course counts the same way", () => {
    render(term([cp({ courseId: "a" }), cp({ courseId: "c" })]), [course("a", "Art"), course("c", "Chem")]);
    expect(coursesCard().textContent).not.toContain("Counted by task where");
  });

  it("marks a partial point total as a floor, and explains the mark once", () => {
    render(
      term([cp({ courseId: "a", pointsCoverage: 0.6 }), cp({ courseId: "b" })]),
      [course("a", "Art"), course("b", "Biology")],
    );
    expect(row("Art").querySelector("[data-floor]")).not.toBeNull();
    expect(row("Art").querySelector(".sr-only")?.textContent).toContain("a floor");
    expect(row("Art").querySelector("[role='meter']")?.getAttribute("aria-label")).toContain(
      "some required items in this course state no point value",
    );
    expect(row("Biology").querySelector("[data-floor]")).toBeNull();
    const footnotes = coursesCard().textContent?.match(/Partial point data/g) ?? [];
    expect(footnotes).toHaveLength(1);
  });

  it("says nothing about a floor when every point total is whole", () => {
    render(term([cp({ courseId: "a" })]), [course("a", "Art")]);
    expect(coursesCard().querySelector("[data-floor]")).toBeNull();
    expect(coursesCard().textContent).not.toContain("Partial point data");
  });

  it("gives a course with no work a sentence, not a 0% bar", () => {
    render(
      term([
        cp({ courseId: "a" }),
        cp({ courseId: "b", itemsTotal: 0, itemsDone: 0, pointsTotal: 0, pointsDone: 0, completionFraction: 0 }),
      ]),
      [course("a", "Art"), course("b", "Biology")],
    );
    expect(row("Biology").textContent).toContain("No work items in this course yet.");
    expect(row("Biology").querySelector("[role='meter']")).toBeNull();
    expect(row("Biology").textContent).not.toMatch(/0%/);
  });
});
