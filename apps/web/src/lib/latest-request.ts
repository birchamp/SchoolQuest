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

/**
 * What a load that has been overtaken does once it finds out.
 *
 * Normally nothing: whatever it read is older than what the newer load will show. The exception
 * is a load whose own replan went through. Two stale loads can both ask the server to generate;
 * the later one commits version N+1 and shows it, while the earlier one loses the unique-index
 * race, retries on the server and commits N+2. By the time the earlier one reads N+2 back its
 * ticket is stale, so dropping that read leaves N+1 on screen though N+2 is the current plan.
 *
 * So a load that committed a plan and was overtaken asks for a fresh read (`"reread"`) under a
 * new ticket. That cannot loop: the fresh read replans only if the plan it finds is stale, and
 * the plan just committed is today's.
 */
export function afterOvertaken(committedPlan: boolean): "drop" | "reread" {
  return committedPlan ? "reread" : "drop";
}
