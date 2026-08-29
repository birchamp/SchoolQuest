import { describe, expect, it } from "vitest";
import { PASTE_MARKER, SUPPORT_EMAIL, supportMailto } from "./support";

describe("the support mailto", () => {
  it("sends to the configured support address", () => {
    // Default build has no VITE_SUPPORT_EMAIL set, so it falls back to the relay mask rather than a
    // personal inbox. A build that sets the var would override this.
    expect(SUPPORT_EMAIL).toBe("v4n5hr02k@mozmail.com");
    expect(supportMailto().startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
  });

  it("prefills a subject and a body the student can paste the log into", () => {
    const decoded = decodeURIComponent(supportMailto());
    expect(decoded).toContain("subject=SchoolQuest problem report");
    expect(decoded).toContain(PASTE_MARKER);
    // The build context rides along in the body, so a report with nothing pasted still names it.
    expect(decoded).toContain("SchoolQuest diagnostics");
    expect(decoded).toContain("Version:");
  });

  it("percent-encodes the body so spaces and newlines survive the URL", () => {
    const href = supportMailto();
    // The raw href must not carry literal spaces or newlines -- those break a mailto in some clients.
    const body = href.split("&body=")[1] ?? "";
    expect(body).not.toMatch(/[ \n]/);
    expect(body).toContain("%20");
  });
});
