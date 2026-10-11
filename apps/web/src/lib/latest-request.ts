/**
 * Lets only the most recently started request write its answer.
 *
 * The plan is reloaded from several places that do not know about each other -- coming back to
 * the window, a ten-minute timer, every save on Setup -- and two of those can be in flight at
 * once. Responses arrive in whatever order the network likes, so without this an older read
 * could land after a newer one and put yesterday's plan back on screen.
 *
 * `begin()` hands out a ticket; `isCurrent(ticket)` is true only until the next `begin()`.
 */
export interface LatestRequest {
  begin(): number;
  isCurrent(ticket: number): boolean;
}

export function latestRequest(): LatestRequest {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (ticket) => ticket === latest,
  };
}
