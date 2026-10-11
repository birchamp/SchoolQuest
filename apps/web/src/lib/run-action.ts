/**
 * What to tell the student when something they asked for did not happen.
 *
 * The thrown message when there is one -- the API client's errors already read as sentences --
 * and the caller's own fallback otherwise, so a bare `throw "x"` or an empty `Error` never
 * surfaces as a blank line or "[object Object]".
 */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message.trim() ? e.message : fallback;
}

/**
 * Runs an action from a button or a settings card and reports how it went, never throwing.
 *
 * The shell used to hand `regenerate` straight to buttons and cards as `void regenerate()`, so a
 * failed rebuild became an unhandled rejection: nothing on screen, the button simply appearing
 * not to work. Everything the shell starts on the student's behalf goes through this instead,
 * and a failure lands on the one error line they can see.
 *
 * `report(null)` clears an earlier failure when a new attempt starts, so a message from the
 * last try does not sit above a retry that worked. Resolves to whether the action succeeded,
 * which is how a caller reverts an optimistic change.
 */
export async function runAction(
  action: () => unknown,
  fallback: string,
  report: (message: string | null) => void,
): Promise<boolean> {
  report(null);
  try {
    await action();
    return true;
  } catch (e) {
    report(errorMessage(e, fallback));
    return false;
  }
}
