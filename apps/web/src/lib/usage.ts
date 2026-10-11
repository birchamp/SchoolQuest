import { createElement, useEffect, useRef, type ReactNode } from "react";
import type { UsageEvent } from "@schoolquest/domain";
import { api } from "./api";

/**
 * The usage log, client side: which screens and controls get used.
 *
 * `track(event)` adds one to an in-memory counter and nothing else -- no request per click. The
 * counters go to `POST /api/usage` once a minute and when the page is hidden or closed, as one
 * small `{ events: { name: count } }` body. Event names come only from the shared allowlist
 * (`USAGE_EVENTS`), so nothing a student types, and no course or assignment, can be in it.
 *
 * Off until the shell turns it on for a signed-in student who has not opted out (Setup, "Share
 * anonymous usage counts"); off again on sign-out or opt-out, which also throws away whatever was
 * counted and not yet sent. Nothing here ever throws into the caller, and a failed send is
 * dropped rather than retried -- a lost minute of counts matters to nobody.
 */

export const FLUSH_INTERVAL_MS = 60_000;

export type UsageSender = (events: Record<string, number>) => Promise<unknown>;

export interface UsageTracker {
  track(event: UsageEvent): void;
  /** Sends what has been counted, if anything. Resolves either way; never rejects. */
  flush(): Promise<void>;
  /** On: counting starts and the timer and page-hide listeners are installed. Off: all removed. */
  setEnabled(enabled: boolean): void;
  /** What is waiting to be sent. For tests. */
  pending(): Record<string, number>;
}

export function createUsageTracker(send: UsageSender): UsageTracker {
  let enabled = false;
  let counts = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  const onPageHide = () => void flush();

  function install() {
    if (timer !== null) return;
    timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  }

  function uninstall() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
  }

  function track(event: UsageEvent) {
    if (!enabled) return;
    counts.set(event, (counts.get(event) ?? 0) + 1);
  }

  async function flush() {
    if (!enabled || counts.size === 0) return;
    const events = Object.fromEntries(counts);
    // Cleared before sending, so a flush that overlaps a slow one cannot send the same counts
    // twice, and a failure loses only this batch.
    counts = new Map();
    try {
      await send(events);
    } catch {
      // Dropped on purpose: no retry, no error on screen.
    }
  }

  function setEnabled(next: boolean) {
    if (next === enabled) return;
    enabled = next;
    if (next) {
      install();
    } else {
      uninstall();
      counts = new Map();
    }
  }

  return { track, flush, setEnabled, pending: () => Object.fromEntries(counts) };
}

const tracker = createUsageTracker((events) => api.postKeepalive("/api/usage", { events }));

/** Counts one use of a screen or control. Safe to call anywhere, any time. */
export function track(event: UsageEvent): void {
  try {
    tracker.track(event);
  } catch {
    // A counter must never break the thing being counted.
  }
}

export const flushUsage = (): Promise<void> => tracker.flush();
export const setUsageEnabled = (enabled: boolean): void => tracker.setEnabled(enabled);

/**
 * Counts `event` once per mount, the first time at least half of `ref`'s element is on screen.
 * Without IntersectionObserver (an old webview, a test) it counts nothing rather than guessing.
 */
export function useSeen<T extends Element>(event: UsageEvent) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let counted = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (counted || !entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) return;
        counted = true;
        track(event);
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [event]);
  return ref;
}

/**
 * Wraps a card so it is counted when seen. `display: contents` would leave nothing to observe,
 * so this is a plain block div; it carries no styling of its own.
 */
export function Seen({ event, children }: { event: UsageEvent; children: ReactNode }) {
  const ref = useSeen<HTMLDivElement>(event);
  return createElement("div", { ref, "data-seen": event }, children);
}
