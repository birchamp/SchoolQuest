// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUsageTracker, FLUSH_INTERVAL_MS, isSeen, type UsageSender } from "./usage";

function setup(send: UsageSender = vi.fn(async () => undefined)) {
  const tracker = createUsageTracker(send);
  return { tracker, send: send as ReturnType<typeof vi.fn> };
}

function hide() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the usage tracker", () => {
  it("counts each event in memory without sending anything", () => {
    const { tracker, send } = setup();
    tracker.setEnabled(true);
    tracker.track("tab.week");
    tracker.track("tab.week");
    tracker.track("coach.send");
    expect(tracker.pending()).toEqual({ "tab.week": 2, "coach.send": 1 });
    expect(send).not.toHaveBeenCalled();
    tracker.setEnabled(false);
  });

  it("sends everything as one batch a minute later, then starts over", async () => {
    const { tracker, send } = setup();
    tracker.setEnabled(true);
    tracker.track("tab.week");
    tracker.track("tab.radar");
    tracker.track("tab.week");
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ "tab.week": 2, "tab.radar": 1 });
    expect(tracker.pending()).toEqual({});
    // Nothing counted, nothing sent.
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
    tracker.setEnabled(false);
  });

  it("flushes when the page is hidden or closed", async () => {
    const { tracker, send } = setup();
    tracker.setEnabled(true);
    tracker.track("tab.week");
    hide();
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith({ "tab.week": 1 });

    tracker.track("tab.stats");
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(send).toHaveBeenLastCalledWith({ "tab.stats": 1 });
    tracker.setEnabled(false);
  });

  it("does nothing at all while off: opted out or signed out", async () => {
    const { tracker, send } = setup();
    tracker.track("tab.week");
    expect(tracker.pending()).toEqual({});
    await tracker.flush();
    hide();
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 3);
    expect(send).not.toHaveBeenCalled();
  });

  it("throws away unsent counts and stops listening when turned off", async () => {
    const { tracker, send } = setup();
    tracker.setEnabled(true);
    tracker.track("tab.week");
    tracker.setEnabled(false);
    expect(tracker.pending()).toEqual({});
    hide();
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a failed send, drops that batch, and does not retry", async () => {
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    const { tracker } = setup(send);
    tracker.setEnabled(true);
    tracker.track("tab.week");
    await expect(tracker.flush()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(tracker.pending()).toEqual({});
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 3);
    expect(send).toHaveBeenCalledTimes(1);
    tracker.setEnabled(false);
  });
});

describe("isSeen", () => {
  it("counts a short card once half of it is on screen", () => {
    expect(isSeen(150, 300, 800)).toBe(true);
    expect(isSeen(149, 300, 800)).toBe(false);
  });

  it("counts a card taller than twice the viewport once it fills half the screen", () => {
    // 3000px of Stats on an 800px screen can never be half visible; a full screen of it is seen.
    expect(isSeen(800, 3000, 800)).toBe(true);
    expect(isSeen(400, 3000, 800)).toBe(true);
    expect(isSeen(399, 3000, 800)).toBe(false);
  });

  it("counts nothing for an element with no height", () => {
    expect(isSeen(0, 0, 800)).toBe(false);
  });
});
