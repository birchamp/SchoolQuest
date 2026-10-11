import { describe, expect, it } from "vitest";
import { conversionZone, servesClient } from "./client-protocol.js";

describe("servesClient", () => {
  it("serves the current app and refuses anything older or unmarked", () => {
    expect(servesClient("2")).toBe(true);
    expect(servesClient("3")).toBe(true);
    expect(servesClient("1")).toBe(false);
    expect(servesClient(undefined)).toBe(false);
    expect(servesClient("two")).toBe(false);
  });
});

describe("conversionZone", () => {
  it("believes a stored zone the student set, wherever the device is", () => {
    // Chicago student, first opening the update in Tokyo.
    expect(conversionZone({ stored: "America/Chicago", mode: "device", device: "Asia/Tokyo" })).toEqual({
      zone: "America/Chicago",
      adopt: false,
    });
  });

  it("keeps a pinned zone", () => {
    expect(conversionZone({ stored: "Europe/Berlin", mode: "pinned", device: "Asia/Tokyo" })).toEqual({
      zone: "Europe/Berlin",
      adopt: false,
    });
    // Even when it is the zone every account started on: pinned, it is a choice, not a default.
    expect(conversionZone({ stored: "America/New_York", mode: "pinned", device: "America/Chicago" })).toEqual({
      zone: "America/New_York",
      adopt: false,
    });
  });

  it("takes the device's zone over the untouched sign-up default, and adopts it", () => {
    expect(conversionZone({ stored: "America/New_York", mode: "device", device: "America/Chicago" })).toEqual({
      zone: "America/Chicago",
      adopt: true,
    });
  });

  it("falls back to what is stored when the device cannot say, or says something unknown", () => {
    expect(conversionZone({ stored: "America/New_York", mode: "device", device: undefined })).toEqual({
      zone: "America/New_York",
      adopt: false,
    });
    expect(conversionZone({ stored: "America/New_York", mode: "device", device: "Etc/Unknown" })).toEqual({
      zone: "America/New_York",
      adopt: false,
    });
    expect(conversionZone({ stored: "Mars/Base", mode: "device", device: undefined })).toEqual({ zone: "UTC", adopt: false });
  });
});
