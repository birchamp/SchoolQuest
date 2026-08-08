import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { connectionFault, connectionMessage } from "./connection";

const PACKAGED = { apiBase: "https://schoolquest-api.workers.dev", packaged: true };
const UNCONFIGURED = { apiBase: "", packaged: true };
const BROWSER = { apiBase: "", packaged: false };

describe("classifying a bootstrap failure", () => {
  it("treats any HTTP response as proof the connection works", () => {
    // Including 401. The app already reads that as "not signed in", and a sign-in screen is the
    // right answer to it — a "cannot reach the server" page would be a lie.
    expect(connectionFault(new ApiError("Not signed in", 401), PACKAGED)).toBeNull();
    expect(connectionFault(new ApiError("Internal error", 500), PACKAGED)).toBeNull();
  });

  it("calls a rejected fetch unreachable when the build has a server address", () => {
    expect(connectionFault(new TypeError("Failed to fetch"), PACKAGED)).toBe("unreachable");
  });

  it("blames the build, not the network, when a packaged app has no server address", () => {
    expect(connectionFault(new TypeError("Failed to fetch"), UNCONFIGURED)).toBe(
      "no-server-configured",
    );
  });

  it("does not blame the build in a browser, where an empty base is same-origin and correct", () => {
    expect(connectionFault(new TypeError("Failed to fetch"), BROWSER)).toBe("unreachable");
  });
});

describe("what the student is told", () => {
  it("offers a retry for a network fault and none for a broken build", () => {
    expect(connectionMessage("unreachable", PACKAGED).canRetry).toBe(true);
    // Retrying a build with no server address in it fails identically, forever.
    expect(connectionMessage("no-server-configured", UNCONFIGURED).canRetry).toBe(false);
  });

  it("names the server the installer was built against, so help can be asked for usefully", () => {
    expect(connectionMessage("unreachable", PACKAGED).detail).toContain(PACKAGED.apiBase);
  });
});
