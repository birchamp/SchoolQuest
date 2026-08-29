import { diagnosticsContext } from "./diagnostics";

/**
 * Where a problem report is sent, and how the email is prefilled.
 *
 * The address is a build-time value, not a literal in the source: it is baked into whatever a
 * particular installer was built against, and shipping the developer's own inbox address in plain
 * source is worse than a var that a fork can point at its own. It falls back to a relay mask -- a
 * throwaway address that forwards -- so a default build still has somewhere to send, without a
 * personal address in the bundle.
 *
 * The full diagnostics log is NOT crammed into the mailto URL: those have hard length limits across
 * mail clients and the OS, and a 500-line log blows past them. The report button copies the log to
 * the clipboard and the body asks the student to paste it; the short context header rides along in
 * the body regardless, so even a report with nothing pasted still names the build.
 */
export const SUPPORT_EMAIL: string =
  ((import.meta.env["VITE_SUPPORT_EMAIL"] as string | undefined) ?? "").trim() ||
  "v4n5hr02k@mozmail.com";

/** Marker the student pastes the copied log beneath. Kept as a constant so a test can assert it. */
export const PASTE_MARKER = "----- paste the copied diagnostics below this line -----";

/** Builds the `mailto:` href for a prefilled problem report. */
export function supportMailto(): string {
  const subject = "SchoolQuest problem report";
  const body = [
    "What went wrong (a sentence or two is plenty):",
    "",
    "",
    PASTE_MARKER,
    "",
    diagnosticsContext(),
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
