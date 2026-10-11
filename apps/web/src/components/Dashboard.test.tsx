// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, ThemeName, WorkItem } from "@schoolquest/domain";
import type { GaugeTarget } from "@schoolquest/planning-engine";
import { ThemeContext } from "../lib/theme-context";
import type { CourseHealthView, TermHealthView } from "../lib/types";

const get = vi.fn();
const put = vi.fn();
vi.mock("../lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));

import { Dashboard } from "./Dashboard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const health = (over: Partial<CourseHealthView>): CourseHealthView => ({
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
  passFailCount: 0,
  targetPercent: 80,
  targetIsOwn: false,
  ungradedResults: 0,
  ...over,
});

const course = (id: string, code: string): Course =>
  ({ id, code, name: `${code} course`, colorToken: null }) as unknown as Course;

const term = (courses: CourseHealthView[]): TermHealthView => ({
  courses,
  coursesAtRisk: courses.filter((c) => c.level === "at_risk").length,
  coursesNeedingAttention: courses.filter((c) => c.level === "needs_attention").length,
  coursesSteady: courses.filter((c) => c.level === "steady").length,
  coursesUnplanned: 0,
});

const ready = (ids: string[], over: Record<string, Partial<{ syllabusCount: number }>> = {}) => ({
  calendarEntries: 8,
  courses: ids.map((id) => ({
    id,
    syllabusCount: 1,
    hasMeetingTimes: true,
    gradingKnown: true,
    workItemCount: 10,
    ...over[id],
  })),
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  put.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(
  h: TermHealthView,
  courses: Course[],
  opts: { theme?: ThemeName; onNavigate?: (t: GaugeTarget) => void; workItems?: WorkItem[] } = {},
) {
  await act(async () => {
    root.render(
      <ThemeContext.Provider value={opts.theme ?? "plain"}>
        <Dashboard
          termId="trm_1"
          health={h}
          courses={courses}
          workItems={opts.workItems ?? []}
          grades={[]}
          onChanged={() => undefined}
          onNavigate={opts.onNavigate ?? (() => undefined)}
          refreshKey={0}
        />
      </ThemeContext.Provider>,
    );
  });
  // Let the readiness fetch resolve and re-render.
  await act(async () => {
    await Promise.resolve();
  });
}

const rowNames = () =>
  [...host.querySelectorAll(".gauge-row strong")].map((el) => el.textContent);

describe("Dashboard (which class needs me)", () => {
  it("has one stable root the rest of the app can find it by", async () => {
    get.mockResolvedValue(ready(["a"]));
    await render(term([health({ courseId: "a" })]), [course("a", "BIO")]);
    expect(host.querySelectorAll("[data-card='class-board']")).toHaveLength(1);
  });

  it("puts the worst class first", async () => {
    get.mockResolvedValue(ready(["a", "b", "c"]));
    await render(
      term([
        health({ courseId: "a" }),
        health({
          courseId: "b",
          level: "needs_attention",
          concerns: [{ code: "UPKEEP_BEHIND", level: "needs_attention", detail: "Upkeep slipped." }],
        }),
        health({
          courseId: "c",
          level: "at_risk",
          concerns: [{ code: "PROJECT_WILL_NOT_FIT", level: "at_risk", detail: "The paper will not fit." }],
        }),
      ]),
      [course("a", "ART"), course("b", "BIO"), course("c", "CHEM")],
    );
    expect(rowNames()).toEqual(["CHEM course", "BIO course", "ART course"]);
    // The sentence is the instruction.
    expect(host.querySelector(".gauge-row p")?.textContent).toBe("The paper will not fit.");
  });

  it("lifts a class the dials see trouble in, even when the engine calls it steady", async () => {
    get.mockResolvedValue(ready(["a", "b"], { a: { syllabusCount: 0 } }));
    await render(
      term([
        health({
          courseId: "b",
          level: "needs_attention",
          concerns: [{ code: "UPKEEP_BEHIND", level: "needs_attention", detail: "Upkeep slipped." }],
        }),
        health({ courseId: "a" }),
      ]),
      [course("a", "ART"), course("b", "BIO")],
    );
    expect(rowNames()[0]).toBe("ART course");
    const first = host.querySelector(".gauge-row")!;
    // The word agrees with the order and the sentence says why.
    expect(first.querySelector("[data-verdict]")?.getAttribute("data-verdict")).toBe("at_risk");
    expect(first.textContent).toContain("No syllabus");
  });

  it("leads with the dial's sentence when the dial is what raised the verdict", async () => {
    // The engine sees only slipped upkeep; the missing syllabus is what makes the class at risk.
    get.mockResolvedValue(ready(["a"], { a: { syllabusCount: 0 } }));
    await render(
      term([
        health({
          courseId: "a",
          level: "needs_attention",
          concerns: [{ code: "UPKEEP_BEHIND", level: "needs_attention", detail: "Upkeep slipped." }],
        }),
      ]),
      [course("a", "ART")],
    );
    const row = host.querySelector(".gauge-row")!;
    expect(row.querySelector("[data-verdict]")?.getAttribute("data-verdict")).toBe("at_risk");
    const headline = row.querySelector("p")!.textContent ?? "";
    expect(headline).toContain("No syllabus");
    expect(headline).not.toContain("Upkeep slipped.");
    // The engine's concern is still there, behind the disclosure.
    expect(row.textContent).toContain("Upkeep slipped.");
  });

  it("never shows the grade without the basis it rests on", async () => {
    get.mockResolvedValue(ready(["a", "b"]));
    await render(
      term([
        health({ courseId: "a", gradePercent: 91.6, gradedWeightFraction: 0.4 }),
        health({ courseId: "b", gradePercent: 74, gradedWeightFraction: 0, gradedCount: 3 }),
      ]),
      [course("a", "ART"), course("b", "BIO")],
    );
    const text = host.textContent ?? "";
    expect(text).toContain("92% · based on 40% of the course graded");
    expect(text).toContain("74% · based on 3 results so far");
  });

  it("offers 'Look at the failed work' for a recorded Fail, and routes it to the work table", async () => {
    get.mockResolvedValue(ready(["a"]));
    const onNavigate = vi.fn();
    await render(
      term([
        health({
          courseId: "a",
          level: "needs_attention",
          gradePercent: null,
          gradedWeightFraction: 0,
          gradedCount: 0,
          passFailCount: 1,
          concerns: [{ code: "PASS_FAIL_FAILED", level: "needs_attention", detail: "Lab safety quiz was a Fail." }],
        }),
      ]),
      [course("a", "BIO")],
      { onNavigate },
    );
    const buttons = [...host.querySelectorAll("button")].filter((b) =>
      /Look at the failed work/.test(b.textContent + " " + (b.getAttribute("aria-label") ?? "")),
    );
    expect(buttons.length).toBeGreaterThan(0);
    act(() => buttons[0]!.click());
    expect(onNavigate).toHaveBeenCalledWith("work");
  });

  it("collapses the remaining concerns behind a disclosure", async () => {
    get.mockResolvedValue(ready(["a"]));
    await render(
      term([
        health({
          courseId: "a",
          level: "needs_attention",
          concerns: [
            { code: "UPKEEP_BEHIND", level: "needs_attention", detail: "Upkeep slipped." },
            { code: "GONE_QUIET", level: "needs_attention", detail: "Quiet for two weeks." },
          ],
        }),
      ]),
      [course("a", "BIO")],
    );
    const details = host.querySelector(".gauge-row details");
    expect(details?.querySelector("summary")?.textContent).toBe("1 more thing about this course");
    expect(details?.textContent).toContain("Quiet for two weeks.");
  });

  it("offers to record a finished, ungraded result, Pass/Fail included", async () => {
    get.mockResolvedValue(ready(["a"]));
    const item = {
      id: "w1",
      courseId: "a",
      title: "Lab report",
      status: "completed",
      dueAt: "2000-01-01T00:00:00Z",
      pointsPossible: 20,
    } as unknown as WorkItem;
    await render(term([health({ courseId: "a", ungradedResults: 1 })]), [course("a", "BIO")], {
      workItems: [item],
    });
    expect(host.textContent).toContain("Record what it scored");
    const labels = [...host.querySelectorAll(".gauge-row button")].map((b) => b.textContent);
    expect(labels).toContain("Pass");
    expect(labels).toContain("Fail");
  });

  it("still answers the question when the setup facts cannot be read, only without dials", async () => {
    get.mockRejectedValue(new Error("offline"));
    await render(term([health({ courseId: "a" })]), [course("a", "BIO")]);
    expect(rowNames()).toEqual(["BIO course"]);
    expect(host.querySelector(".gauge-row svg")).toBeNull();
  });

  it("speaks the same words under every theme", async () => {
    const spoken: string[] = [];
    for (const theme of ["plain", "quest", "mission"] as const) {
      get.mockResolvedValue(ready(["a"]));
      await render(term([health({ courseId: "a" })]), [course("a", "BIO")], { theme });
      const clone = host.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[aria-hidden='true']").forEach((el) => el.remove());
      const labels = [...clone.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));
      spoken.push((clone.textContent ?? "") + labels.join("|"));
    }
    expect(spoken[1]).toBe(spoken[0]);
    expect(spoken[2]).toBe(spoken[0]);
  });
});
