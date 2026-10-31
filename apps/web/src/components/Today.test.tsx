// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, WorkItem } from "@schoolquest/domain";
import { ThemeContext } from "../lib/theme-context";
import type { PlanResponse, PlannedSession, Recommendation } from "../lib/types";

const post = vi.fn();
vi.mock("../lib/api", () => ({
  api: { post: (...a: unknown[]) => post(...a), get: vi.fn(), put: vi.fn() },
}));

import { Today } from "./Today";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 10:00 on the device's clock, `days` days from today, as the UTC instant every stored time is. */
function at(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

const session = (id: string, workItemId: string, startAt: string, status = "planned"): PlannedSession => ({
  id,
  workItemId,
  courseId: "crs_1",
  startAt,
  endAt: new Date(Date.parse(startAt) + 60 * 60_000).toISOString(),
  minutes: 60,
  status,
  locked: false,
  acceptedByUser: false,
  reasonCodes: [],
  tradeoffCode: null,
});

const TODAY = session("ses_today", "wi_essay", at(0));
const TOMORROW = session("ses_tomorrow", "wi_reading", at(1));

const primary = (over: Partial<Recommendation> = {}): Recommendation => ({
  rank: 0,
  sessionId: TODAY.id,
  workItemId: TODAY.workItemId,
  title: "Essay draft",
  courseId: "crs_1",
  durationMinutes: 60,
  startAt: TODAY.startAt,
  reasonCodes: [],
  explanation: "Work on Essay draft.",
  tradeoff: null,
  ...over,
});

function plan(over: Partial<PlanResponse> = {}): PlanResponse {
  return {
    capacity: { usedMinutes: 120, availableMinutes: 600 },
    sessions: [TODAY, TOMORROW],
    recommendations: [primary()],
    risks: [],
    unscheduledWorkItemIds: [],
    courses: [{ id: "crs_1", code: "ENG 101", name: "Writing", colorToken: null } as unknown as Course],
    workItems: [
      { id: "wi_essay", title: "Essay draft", courseId: "crs_1" } as unknown as WorkItem,
      { id: "wi_reading", title: "Chapter reading", courseId: "crs_1" } as unknown as WorkItem,
    ],
    standings: {},
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
let onReplan: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  post.mockReset();
  post.mockResolvedValue({ session: {} });
  onReplan = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(p: PlanResponse) {
  await act(async () => {
    root.render(
      <ThemeContext.Provider value="plain">
        <Today
          plan={p}
          termId="trm_1"
          onChanged={() => undefined}
          onReplan={onReplan}
          onGoToSetup={() => undefined}
          onOpenWork={() => undefined}
        />
      </ThemeContext.Provider>,
    );
  });
}

const comingUp = () => host.querySelector("section.card.protected")!;
const doNowButton = () => comingUp().querySelector<HTMLButtonElement>("button.do-now");
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const buttonNamed = (text: string) =>
  [...comingUp().querySelectorAll("button")].find((b) => b.textContent === text) ?? null;

describe("Today, do it now on a Coming up row", () => {
  it("offers tomorrow's work for now, and names both blocks before anything moves", async () => {
    await render(plan());
    const button = doNowButton();
    expect(button?.textContent).toBe("Do it now");
    expect(button?.getAttribute("aria-label")).toBe("Do Chapter reading now");
    expect(comingUp().textContent).not.toContain("Yes, start it now");

    await click(button);
    const text = comingUp().textContent ?? "";
    expect(text).toContain("Chapter reading");
    expect(text).toContain("Essay draft will be rebooked");
    expect(post).not.toHaveBeenCalled();
  });

  it("moves tomorrow's block into the current slot and replans", async () => {
    await render(plan());
    await click(doNowButton());
    await click(buttonNamed("Yes, start it now"));

    expect(post).toHaveBeenCalledWith(`/api/work-sessions/${TOMORROW.id}/do-now`, {
      startAt: TODAY.startAt,
      displacing: TODAY.id,
    });
    expect(onReplan).toHaveBeenCalledTimes(1);
    expect(comingUp().textContent).not.toContain("Yes, start it now");
  });

  it("keeps the plan when asked to, without a request", async () => {
    await render(plan());
    await click(doNowButton());
    await click(buttonNamed("Keep the plan"));
    expect(comingUp().textContent).not.toContain("Yes, start it now");
    expect(post).not.toHaveBeenCalled();
    expect(onReplan).not.toHaveBeenCalled();
  });

  it("starts the slot now when nothing is recommended", async () => {
    await render(plan({ sessions: [TOMORROW], recommendations: [] }));
    const before = Date.now();
    await click(doNowButton());
    expect(comingUp().textContent).toContain("The rest of the week will be redrawn");
    await click(buttonNamed("Yes, start it now"));
    const [path, body] = post.mock.calls[0] as [string, { startAt: string; displacing?: string }];
    expect(path).toBe(`/api/work-sessions/${TOMORROW.id}/do-now`);
    expect(body.displacing).toBeUndefined();
    expect(Date.parse(body.startAt)).toBeGreaterThanOrEqual(before);
  });

  it("offers nothing while a block is underway", async () => {
    await render(
      plan({
        sessions: [session(TODAY.id, TODAY.workItemId, TODAY.startAt, "started"), TOMORROW],
        recommendations: [primary({ status: "started" })],
      }),
    );
    expect(comingUp().textContent).toContain("Chapter reading");
    expect(doNowButton()).toBeNull();
  });

  it("shows the failure and leaves the plan alone when the server refuses", async () => {
    post.mockRejectedValue(new Error("That time is already booked for Lab."));
    await render(plan());
    await click(doNowButton());
    await click(buttonNamed("Yes, start it now"));
    expect(host.textContent).toContain("That time is already booked for Lab.");
    expect(onReplan).not.toHaveBeenCalled();
  });
});
