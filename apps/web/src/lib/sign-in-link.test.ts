import { describe, expect, it } from "vitest";
import { loginTokenFrom } from "./sign-in-link";

const TOKEN = "a".repeat(64);
const LINK = `https://schoolquest.pages.dev/auth/callback?token=${TOKEN}`;

describe("reading a sign-in link", () => {
  it("takes the token out of the link the API mails", () => {
    expect(loginTokenFrom(LINK)).toBe(TOKEN);
  });

  it("accepts a bare token, which is what the dev sign-in path hands over", () => {
    expect(loginTokenFrom(TOKEN)).toBe(TOKEN);
  });

  // Every one of these is a real shape a paste arrives in, and each was worth handling because
  // the alternative is telling a student who did exactly the right thing that their link is bad.
  it.each([
    ["angle brackets, as plain-text mail clients add", `<${LINK}>`],
    ["a trailing full stop from the end of a sentence", `${LINK}.`],
    ["leading and trailing whitespace from a drag-select", `  ${LINK}\n`],
    ["a quoted-reply marker", `"${LINK}"`],
  ])("survives %s", (_why, pasted) => {
    expect(loginTokenFrom(pasted)).toBe(TOKEN);
  });

  it("reads a token carried in the fragment, which link trackers do not rewrite", () => {
    expect(loginTokenFrom(`https://schoolquest.pages.dev/#/auth/callback?token=${TOKEN}`)).toBe(
      TOKEN,
    );
    expect(loginTokenFrom(`https://schoolquest.pages.dev/#token=${TOKEN}`)).toBe(TOKEN);
  });

  it("finds nothing in the ordinary addresses the app runs at", () => {
    // Called on every boot against location.href, so the no-token case is the common one.
    expect(loginTokenFrom("tauri://localhost/")).toBeNull();
    expect(loginTokenFrom("https://schoolquest.pages.dev/")).toBeNull();
    expect(loginTokenFrom("http://localhost:5173/?tab=week")).toBeNull();
  });

  it("finds nothing in text that is not a link", () => {
    expect(loginTokenFrom("")).toBeNull();
    expect(loginTokenFrom("   ")).toBeNull();
    expect(loginTokenFrom("Sign in to SchoolQuest:")).toBeNull();
    // Half a token is not a token: sending it would burn nothing but return a confusing 401.
    expect(loginTokenFrom("a".repeat(32))).toBeNull();
  });
});
