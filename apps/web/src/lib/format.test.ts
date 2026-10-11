import { describe, expect, it } from "vitest";
import { courseLabel, courseNameWithCode, formatEffort, initialsFor } from "./format";

describe("formatEffort", () => {
  it("keeps minutes under an hour as minutes", () => {
    expect(formatEffort(0)).toBe("0m");
    expect(formatEffort(45)).toBe("45m");
    expect(formatEffort(59)).toBe("59m");
  });

  it("drops the minutes on a whole hour", () => {
    expect(formatEffort(60)).toBe("1h");
    expect(formatEffort(180)).toBe("3h");
  });

  it("splits hours and minutes", () => {
    expect(formatEffort(95)).toBe("1h 35m");
    expect(formatEffort(61)).toBe("1h 1m");
    expect(formatEffort(605)).toBe("10h 5m");
  });
});

describe("courseNameWithCode", () => {
  it("appends the code", () => {
    expect(courseNameWithCode({ name: "Revelation", code: "REL 101" })).toBe(
      "Revelation (REL 101)",
    );
  });

  it("does not repeat a code the name already carries", () => {
    expect(courseNameWithCode({ name: "General Biology I (BIO 240)", code: "BIO 240" })).toBe(
      "General Biology I (BIO 240)",
    );
  });

  it("falls back to the bare name with no code", () => {
    expect(courseNameWithCode({ name: "Choir", code: null })).toBe("Choir");
    expect(courseNameWithCode({ name: "Choir", code: "" })).toBe("Choir");
  });
});

describe("courseLabel", () => {
  it("labels a known course with its code", () => {
    expect(courseLabel({ name: "Revelation", code: "REL 101" }, "abc")).toBe(
      "Revelation (REL 101)",
    );
  });

  it("stands in with a short id for a missing course", () => {
    expect(courseLabel(undefined, "c0ffee1234")).toBe("Course c0ffee");
  });
});

describe("initialsFor", () => {
  it("takes the first letter of two words", () => {
    expect(initialsFor({ name: "Revelation", code: "REL 101" }, "x")).toBe("REL");
    expect(initialsFor({ name: "General Biology", code: null }, "x")).toBe("GB");
  });

  it("skips digits rather than reading them as letters", () => {
    expect(initialsFor({ name: "x", code: "BIO 240" }, "x")).toBe("BIO");
    expect(initialsFor({ name: "x", code: "CS 2 Lab" }, "x")).toBe("CL");
  });

  it("uses up to three letters of a single word", () => {
    expect(initialsFor({ name: "choir", code: null }, "x")).toBe("CHO");
    expect(initialsFor({ name: "Pe", code: null }, "x")).toBe("PE");
  });

  it("falls back to the id, then to a question mark", () => {
    expect(initialsFor(undefined, "math-course")).toBe("MC");
    expect(initialsFor(undefined, "1234")).toBe("?");
  });
});
