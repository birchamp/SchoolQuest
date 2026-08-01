import { useCallback, useEffect, useState } from "react";

/**
 * How the student wants their data shown.
 *
 * Every visual view in this app was designed first — the week as beats, the term as an arc,
 * the courses as a board — and each of them trades completeness for legibility on purpose.
 * That trade is right for the student who cannot hold nine things at once, and wrong for the
 * one who wants to scan every row, sort by date, or simply read the numbers without a
 * metaphor in the way. Neither of those students is unusual and neither is a fallback for
 * the other, so the choice is theirs and it persists.
 *
 * Kept in localStorage rather than on the user record: it is a preference about this screen
 * in front of this person, the same as theme would be if theme were not also a design
 * statement, and it should not cost a round trip to flip.
 */

export type ViewMode = "visual" | "table";

const KEY = "sq_view_mode";

function read(): ViewMode {
  if (typeof localStorage === "undefined") return "visual";
  return localStorage.getItem(KEY) === "table" ? "table" : "visual";
}

/**
 * The mode, and a setter that tells every other subscriber.
 *
 * `storage` only fires in *other* tabs, so a custom event carries the change within this
 * one. Without it the header toggle and the views below it hold separate copies of the same
 * state and the page half-switches.
 */
export function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(read);

  useEffect(() => {
    const sync = () => setMode(read());
    window.addEventListener("storage", sync);
    window.addEventListener("sq:view-mode", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("sq:view-mode", sync);
    };
  }, []);

  const update = useCallback((next: ViewMode) => {
    localStorage.setItem(KEY, next);
    setMode(next);
    window.dispatchEvent(new Event("sq:view-mode"));
  }, []);

  return [mode, update];
}
