import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { termCalendar } from "@schoolquest/domain";
import { jsonObject, JsonColumnError, parseJsonColumn, requireJsonColumn } from "./json-column.js";

const counted = z.object({ exceptions: z.array(z.unknown()).optional() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseJsonColumn", () => {
  it("returns the parsed value when the text matches the schema", () => {
    expect(parseJsonColumn(counted, '{"exceptions":[1,2]}', {})).toEqual({ exceptions: [1, 2] });
  });

  it("applies schema defaults, as the domain schemas did when called directly", () => {
    const calendar = parseJsonColumn(termCalendar, "{}", termCalendar.parse({}));
    expect(calendar).toEqual(termCalendar.parse({}));
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["truncated JSON", '{"exceptions":[1,'],
    ["a schema mismatch", '{"exceptions":"three"}'],
    ["an array where an object belongs", "[1,2,3]"],
    ["empty text", ""],
    ["null", null],
  ])("falls back on %s and logs which column", (_label, text) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fallback = { exceptions: [] };
    expect(parseJsonColumn(counted, text, fallback, "terms.calendar_json")).toBe(fallback);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain("terms.calendar_json");
  });

  it("never throws, even when the schema itself would", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => parseJsonColumn(z.array(z.string()), "{", [])).not.toThrow();
  });
});

describe("requireJsonColumn", () => {
  it("returns the parsed value when the text matches the schema", () => {
    expect(requireJsonColumn(counted, '{"exceptions":[]}', "terms.calendar_json")).toEqual({
      exceptions: [],
    });
  });

  it.each([
    ["malformed JSON", "{not json", "not JSON"],
    ["a schema mismatch", '{"exceptions":"three"}', "exceptions"],
    ["empty text", "", "empty"],
  ])("throws a JsonColumnError naming the column on %s", (_label, text, reason) => {
    let caught: unknown;
    try {
      requireJsonColumn(counted, text, "extraction_claims.payload_json");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsonColumnError);
    expect((caught as JsonColumnError).column).toBe("extraction_claims.payload_json");
    expect((caught as Error).message).toContain("extraction_claims.payload_json");
    expect((caught as Error).message).toContain(reason);
  });

  it("keeps keys a passthrough schema does not name, so a read-modify-write loses nothing", () => {
    const payload = z.object({ title: z.string() }).passthrough();
    const parsed = requireJsonColumn(payload, '{"title":"Lab","evidenceVerified":true}', "x");
    expect(parsed).toEqual({ title: "Lab", evidenceVerified: true });
  });
});

describe("jsonObject", () => {
  it("accepts any object and keeps every key", () => {
    expect(requireJsonColumn(jsonObject, '{"a":1,"b":{"c":[2]}}', "x")).toEqual({ a: 1, b: { c: [2] } });
  });

  it("rejects an array and null, which a spread would silently mangle", () => {
    expect(() => requireJsonColumn(jsonObject, "[1]", "x")).toThrow(JsonColumnError);
    expect(() => requireJsonColumn(jsonObject, "null", "x")).toThrow(JsonColumnError);
  });
});
