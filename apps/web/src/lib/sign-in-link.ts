/**
 * Pulls the login token out of whatever the student actually has in front of them.
 *
 * The API mails `${APP_URL}/auth/callback?token=…`. In a browser that URL is opened directly
 * and the token arrives in `location.href`. In the desktop app it cannot be: the window loads
 * from `tauri://localhost`, the operating system hands the emailed link to the default browser,
 * and the desktop window never sees it. The only thing that crosses that gap is the clipboard —
 * so the sign-in screen has to accept a pasted link, not just a bare token.
 *
 * Everything here is about what a paste really looks like. Mail clients wrap long URLs in angle
 * brackets, some add a trailing full stop, and selecting a link in Outlook or Gmail picks up
 * surrounding whitespace and the occasional newline. A student who does the right thing and
 * pastes should not be told their link is invalid because of a bracket.
 */

/** The API issues 32 random bytes as lowercase hex; see `randomToken` in apps/api/src/auth.ts. */
const BARE_TOKEN = /^[0-9a-f]{64}$/i;

/** Trimmed off pasted text: mail-client link wrappers, quoting marks, sentence punctuation. */
const SURROUNDING = /^[\s<("'[]+|[\s>)"'\].,;]+$/g;

/**
 * Returns the login token in `input`, or null when there is nothing usable in it.
 *
 * Accepts a full sign-in URL, a bare token, and a URL whose token sits in the fragment rather
 * than the query — the last because link trackers and some mail apps rewrite query strings, and
 * a fragment survives that.
 */
export function loginTokenFrom(input: string): string | null {
  const cleaned = input.replace(SURROUNDING, "");
  if (!cleaned) return null;

  if (BARE_TOKEN.test(cleaned)) return cleaned.toLowerCase();

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }

  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery.trim();

  // `#token=…` and `#/auth/callback?token=…` both show up depending on how the app is hosted,
  // so the fragment is searched as a parameter string rather than parsed as a path.
  const fragment = url.hash.replace(/^#/, "");
  const fromHash = new URLSearchParams(fragment.includes("?") ? fragment.split("?")[1] : fragment);
  return fromHash.get("token")?.trim() || null;
}
