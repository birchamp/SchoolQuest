/**
 * Takes only the fields a profile save changed from its reply, keeping the rest of the profile
 * as it is now.
 *
 * Every `/api/me` write answers with the whole profile, and saves can overlap -- a theme click
 * while the usage switch is saving. Replacing the profile with each reply let whichever answered
 * last win every field, so a theme reply carrying the old `shareUsage: true` undid a successful
 * opt-out on screen and switched counting back on (found in review on #41). Each save owns its
 * own fields and nothing else.
 */
export function mergeProfile<T extends object, K extends keyof T>(
  current: T | null,
  reply: T,
  fields: readonly K[],
): T {
  if (!current) return reply;
  const next = { ...current };
  for (const field of fields) next[field] = reply[field];
  return next;
}
