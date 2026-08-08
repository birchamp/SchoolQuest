import { ApiError } from "./api";

/**
 * Why the app could not talk to its server, in the terms a student can act on.
 *
 * The distinction exists because the two faults have completely different fixes and the
 * underlying failure is identical: `fetch` rejects with a `TypeError` for a dead network, a
 * wrong hostname, a CORS rejection and a Content-Security-Policy block alike. The browser
 * deliberately refuses to say which — so the app has to reason from what it knows about its
 * own build rather than from the error.
 */
export type ConnectionFault =
  /** The installer was built without VITE_API_URL, so there is no server to reach at all. */
  | "no-server-configured"
  /** There is a server address; nothing answered on it. */
  | "unreachable";

/**
 * Classifies a bootstrap failure, or returns null when the server answered and the problem is
 * something else.
 *
 * An `ApiError` means an HTTP response came back, which is proof the network works — including
 * a 401, which the caller treats as "not signed in" rather than a fault. Only a rejected fetch
 * gets here as a connection problem.
 */
export function connectionFault(
  error: unknown,
  { apiBase, packaged }: { apiBase: string; packaged: boolean },
): ConnectionFault | null {
  if (error instanceof ApiError) return null;

  // A packaged desktop build loads from tauri://localhost. With no API base, every relative
  // request resolves against that origin, where nothing is listening and nothing ever will be —
  // this is a broken build, not a broken connection, and saying "check your internet" would send
  // the student looking in the wrong place forever.
  if (packaged && !apiBase) return "no-server-configured";

  return "unreachable";
}

/** What to put on screen for each fault. Plain sentences, no status codes, one thing to try. */
export function connectionMessage(
  fault: ConnectionFault,
  { apiBase, packaged }: { apiBase: string; packaged: boolean },
): { title: string; detail: string; canRetry: boolean } {
  if (fault === "no-server-configured") {
    return {
      title: "This copy of SchoolQuest is missing its server address",
      detail:
        "It was built without one, so it cannot sign you in or load a plan. Download the " +
        "installer again from the SchoolQuest releases page — a correctly built copy will work " +
        "straight away.",
      canRetry: false,
    };
  }

  return {
    title: "SchoolQuest cannot reach its server",
    detail: packaged
      ? `Check that you are online, then try again. If your connection is fine, the server at ${apiBase} may be down for a few minutes.`
      : "Check that you are online, then try again.",
    canRetry: true,
  };
}
