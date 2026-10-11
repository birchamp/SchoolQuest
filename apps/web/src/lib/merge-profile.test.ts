import { describe, expect, it } from "vitest";
import { mergeProfile } from "./merge-profile";

type Profile = { theme: string; shareUsage: boolean; timezone: string };

describe("mergeProfile", () => {
  it("lets an overlapping save's late reply change only its own field", () => {
    // The opt-out landed; then a theme save that started earlier answers with the old sharing value.
    const afterOptOut: Profile = { theme: "plain", shareUsage: false, timezone: "UTC" };
    const lateThemeReply: Profile = { theme: "quest", shareUsage: true, timezone: "UTC" };
    expect(mergeProfile(afterOptOut, lateThemeReply, ["theme"])).toEqual({
      theme: "quest",
      shareUsage: false,
      timezone: "UTC",
    });
  });

  it("never brings a signed-out profile back from a late reply", () => {
    const reply: Profile = { theme: "plain", shareUsage: true, timezone: "UTC" };
    expect(mergeProfile(null, reply, ["theme"])).toBeNull();
  });
});
