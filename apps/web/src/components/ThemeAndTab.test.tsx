// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThemeName } from "@schoolquest/domain";
import { Stats } from "./Stats";
import { ThemeContext } from "../lib/theme-context";
import { useHashTab, type Tab } from "../lib/tab-route";
import type { ProjectsSummaryView, TermProgressView } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** No work yet: the one state of the term card whose every word depends on the theme. */
const EMPTY: TermProgressView = {
  courses: [],
  itemsTotal: 0,
  itemsDone: 0,
  pointsTotal: 0,
  pointsDone: 0,
  pointsCoverage: 0,
  completionFraction: 0,
  basis: "items",
  effortMinutes: 0,
  sessionsCompleted: 0,
};

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

const PLAIN_LINE =
  "No work items have been added to your courses yet, so there is no term completion to report.";

/** The term card's heading and its sentence: the first card the Stats screen renders. */
const heading = () => host.querySelector("h2");
const sentence = () => host.querySelector("section p:not([aria-hidden])");

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
  window.history.replaceState(null, "", "/");
});

describe("ThemeContext", () => {
  function renderIn(theme: ThemeName | null) {
    const card = <Stats projects={NO_PROJECTS} progress={EMPTY} courses={[]} standings={{}} />;
    act(() =>
      root.render(
        theme === null ? card : <ThemeContext.Provider value={theme}>{card}</ThemeContext.Provider>,
      ),
    );
  }

  it("reaches a component and the Themed wording inside it", () => {
    renderIn("quest");
    expect(heading()?.querySelector("[aria-hidden='true']:not(:first-child)")?.textContent).toBe(
      "The campaign so far",
    );
    const visible = sentence()?.querySelector("[aria-hidden='true']");
    const spoken = sentence()?.querySelector(".sr-only");
    expect(visible?.textContent).toMatch(/^Nothing charted for the term yet/);
    // What a screen reader hears never depends on the theme.
    expect(spoken?.textContent).toBe(PLAIN_LINE);
  });

  it("follows a change of theme without remounting", () => {
    renderIn("quest");
    renderIn("mission");
    expect(heading()?.querySelector("[aria-hidden='true']")?.textContent).toBe("Semester status");
    expect(heading()?.querySelector(".sr-only")?.textContent).toBe("Semester at a glance");
  });

  it("falls back to Plain outside the provider", () => {
    // Body attribute deliberately set to something else: nothing reads it back any more.
    document.body.dataset["theme"] = "quest";
    renderIn(null);
    delete document.body.dataset["theme"];
    expect(heading()?.textContent).toBe("Semester at a glance");
    // Plain wording equals the spoken wording, so Themed renders it once, unsplit.
    expect(sentence()?.textContent).toBe(PLAIN_LINE);
    expect(sentence()?.querySelector("[aria-hidden='true']")).toBeNull();
  });
});

describe("useHashTab", () => {
  let select: (next: Tab) => void = () => undefined;
  function Probe() {
    const [tab, setTab] = useHashTab();
    select = setTab;
    return <output>{tab}</output>;
  }
  const shown = () => host.querySelector("output")?.textContent;

  it("reads the tab from the hash on load", () => {
    window.history.replaceState(null, "", "/#week");
    act(() => root.render(<Probe />));
    expect(shown()).toBe("week");
  });

  it("lands on the radar with no hash or an unknown one", () => {
    window.history.replaceState(null, "", "/#nonsense");
    act(() => root.render(<Probe />));
    expect(shown()).toBe("radar");
  });

  it("pushes one history entry per change, and none for the tab already open", () => {
    window.history.replaceState(null, "", "/");
    act(() => root.render(<Probe />));
    const before = window.history.length;
    act(() => select("radar"));
    expect(window.history.length).toBe(before);
    act(() => select("stats"));
    expect(shown()).toBe("stats");
    expect(window.location.hash).toBe("#stats");
    expect(window.history.length).toBe(before + 1);
  });

  it("follows the hash when it changes underneath (Back, Forward, an edited address)", () => {
    window.history.replaceState(null, "", "/#today");
    act(() => root.render(<Probe />));
    act(() => {
      window.history.replaceState(null, "", "/#coach");
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(shown()).toBe("coach");
  });
});
