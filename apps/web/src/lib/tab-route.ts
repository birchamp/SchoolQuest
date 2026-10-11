import { useCallback, useEffect, useState } from "react";

/**
 * `work` is its own tab rather than a view toggle.
 *
 * The assignments table is where a syllabus gets corrected -- a date moved, a task set in class,
 * a chapter dropped -- which is a weekly errand for the whole term. It was reachable only by
 * switching the view mode to Tables while on the week, which is two deductions a student has to
 * make before they can fix a date their instructor just changed. A thing done every week gets a
 * door of its own, and correcting a date is not a "table view" preference.
 */
export const TABS = ["radar", "today", "week", "work", "stats", "coach", "setup"] as const;
export type Tab = (typeof TABS)[number];

/**
 * The radar opens the app.
 *
 * Today answers "what do I do in the next hour", which is the right question once you have
 * already decided the week is under control. Deciding that is the harder problem and the
 * one nothing else here answered: the radar is where a student sees what is coming before
 * choosing what to do about it, so it comes first and it comes up first.
 */
export const DEFAULT_TAB: Tab = "radar";

/** The tab a location hash names, or the landing tab for anything else (empty, stale, typo). */
export function tabFromHash(hash: string): Tab {
  const id = hash.replace(/^#/, "");
  return (TABS as readonly string[]).includes(id) ? (id as Tab) : DEFAULT_TAB;
}

function currentHashTab(): Tab {
  return typeof window === "undefined" ? DEFAULT_TAB : tabFromHash(window.location.hash);
}

/**
 * The open tab, kept in the URL hash (`#week`).
 *
 * As local state a refresh always landed on the radar and Back did nothing at all, which in an
 * installed PWA or the desktop shell -- no address bar, a Back gesture or mouse button only --
 * reads as the app ignoring you. A hash rather than a path because it never reaches the server
 * or the service worker's navigation fallback, and resolves the same under `tauri://localhost`
 * as under `http://`.
 *
 * Choosing a tab pushes a history entry (not when it is already the open one, so a repeat click
 * does not make Back need two presses). `hashchange` and `popstate` cover Back/Forward and an
 * edited address bar; both are listened for because a pushState entry is not guaranteed to fire
 * `hashchange` when it is traversed, and setting the same tab twice is harmless.
 */
export function useHashTab(): [Tab, (next: Tab) => void] {
  const [tab, setTab] = useState<Tab>(currentHashTab);

  useEffect(() => {
    const sync = () => setTab(currentHashTab());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const select = useCallback((next: Tab) => {
    // Compared as tabs, not strings, so the bare landing URL counts as already on the radar.
    if (currentHashTab() !== next) {
      // Relative, for the same reason as the sign-in redirect: under the desktop shell's custom
      // scheme `location.origin` can be the string "null".
      window.history.pushState(null, "", `#${next}`);
    }
    setTab(next);
  }, []);

  return [tab, select];
}
