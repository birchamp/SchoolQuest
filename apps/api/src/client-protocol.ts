import { isTimeZone } from "@schoolquest/domain";

/**
 * The client protocol: which apps the API serves.
 *
 * Version 2 is the first app that knows every stored time is UTC (issue #4). An older app reads
 * UTC values as local ones and writes local ones as UTC, and nothing ever corrects what it writes,
 * so it is refused on *every* request, not only while an account is being converted -- a review
 * found an old phone tab served happily again the moment a laptop converted the account. Refused
 * with 426 rather than 409, which already means "that block is in the way", so the two cannot be
 * confused. Bump this when a change makes older apps unsafe to serve.
 */
export const CLIENT_PROTOCOL = 2;
export const CLIENT_PROTOCOL_HEADER = "X-SchoolQuest-Client";
export const DEVICE_ZONE_HEADER = "X-Device-Time-Zone";

export const UPGRADE_MESSAGE =
  "SchoolQuest was updated. Reload this page, or if you use the desktop app, install the latest version.";

/** Whether a request comes from an app this API may serve. */
export function servesClient(header: string | undefined): boolean {
  const version = Number(header);
  return Number.isInteger(version) && version >= CLIENT_PROTOCOL;
}

/** The zone every account was given at sign-up, before the app reported where anyone was. */
export const SIGN_UP_DEFAULT_ZONE = "America/New_York";

/**
 * The zone an old account's local-time records were written in, for its one conversion to UTC.
 *
 * The stored zone, whenever it can be believed: pinned by the student, or kept in step with their
 * device by an app since this zone was introduced -- which is the zone they were living in when
 * they typed those records. The device's zone only when the stored one is still the untouched
 * sign-up default, which says nothing; trusting the device over a real stored zone converted a
 * Chicago student who first opened the update on a trip to Tokyo as Tokyo, permanently.
 *
 * `adopt` says whether the account should take the result as its zone: only when it replaces
 * the default. A real stored zone is left alone, so the app can notice the device has moved and
 * ask, rather than the conversion moving it silently.
 */
export function conversionZone(input: {
  stored: string;
  mode: string;
  device: string | undefined;
}): { zone: string; adopt: boolean } {
  const storedOk = isTimeZone(input.stored);
  const deviceOk = input.device !== undefined && isTimeZone(input.device);
  if (input.mode === "pinned" && storedOk) return { zone: input.stored, adopt: false };
  if (storedOk && input.stored !== SIGN_UP_DEFAULT_ZONE) return { zone: input.stored, adopt: false };
  if (deviceOk) return { zone: input.device!, adopt: input.device !== input.stored };
  return { zone: storedOk ? input.stored : "UTC", adopt: false };
}
