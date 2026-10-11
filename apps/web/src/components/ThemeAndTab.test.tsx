// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThemeName } from "@schoolquest/domain";
import { Questline } from "./Questline";
import { ThemeContext } from "../lib/theme-context";
import { useHashTab, type Tab } from "../lib/tab-route";
import type { TermProgressView } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** No courses yet: the one state of the card whose every word depends on the theme. */
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

const PLAIN_LINE = "No courses yet. Add a course and its work will appear here.";

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
    const card = <Questline progress={EMPTY} courses={[]} />;
    act(() =>
      root.render(
        theme === null ? card : <ThemeContext.Provider value={theme}>{card}</ThemeContext.Provider>,
      ),
    );
  }

  it("reaches a component and the Themed wording inside it", () => {
    renderIn("quest");
    expect(host.querySelector("h2")?.textContent).toContain("Questlines");
    const visible = host.querySelector("p [aria-hidden='true']");
    const spoken = host.querySelector("p .sr-only");
    expect(visible?.textContent).toMatch(/^No questlines yet\./);
    // What a screen reader hears never depends on the theme.
    expect(spoken?.textContent).toBe(PLAIN_LINE);
  });

  it("follows a change of theme without remounting", () => {
    renderIn("quest");
    renderIn("mission");
    expect(host.querySelector("h2")?.textContent).toBe("Theaters");
  });

  it("falls back to Plain outside the provider", () => {
    // Body attribute deliberately set to something else: nothing reads it back any more.
    document.body.dataset["theme"] = "quest";
    renderIn(null);
    delete document.body.dataset["theme"];
    expect(host.querySelector("h2")?.textContent).toBe("Course progress");
    // Plain wording equals the spoken wording, so Themed renders it once, unsplit.
    expect(host.querySelector("p")?.textContent).toBe(PLAIN_LINE);
    expect(host.querySelector("p [aria-hidden='true']")).toBeNull();
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
