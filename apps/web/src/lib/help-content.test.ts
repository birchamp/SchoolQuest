import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_LABELS } from "./help-content";

/**
 * The Help page teaches a vocabulary -- Skip, Cancel, Move and pin -- that also lives as literal
 * button text in the app. If a future change renames one of those controls, the guide silently
 * goes wrong. These checks tie each word in `APP_LABELS` to the component it belongs to, so a
 * rename fails here and prompts updating both, rather than rotting the help page unnoticed.
 */
function componentSource(name: string): string {
  return readFileSync(join(import.meta.dirname, "..", "components", name), "utf8");
}

describe("help vocabulary stays in sync with the app", () => {
  it("the block-skip label is still on Today", () => {
    expect(componentSource("Today.tsx")).toContain(APP_LABELS.skipBlock);
  });

  it("the assignment-cancel label is still on the assignments table", () => {
    expect(componentSource("Tables.tsx")).toContain(APP_LABELS.cancelTask);
  });

  it("the move-and-pin label is still on the week calendar", () => {
    expect(componentSource("WeekCalendar.tsx")).toContain(APP_LABELS.moveAndPin);
  });
});
