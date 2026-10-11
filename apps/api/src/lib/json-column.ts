import { z } from "zod";

/**
 * Reading the JSON the database stores in text columns.
 *
 * Every one of these used to be `JSON.parse(text) as T`: a cast, so a row written by an older
 * version, edited by hand, or truncated read as whatever shape the caller hoped for, and the first
 * sign of trouble was a `TypeError` several lines later or a value quietly shown as `undefined`.
 * These two functions put a schema at the boundary instead, and make the caller say out loud what
 * should happen when the stored text does not match it.
 *
 * Which one to use is a decision about the call site, not about the column:
 *
 * - `parseJsonColumn` (fallback) for **display**: a list, a count, a screen. One bad row should
 *   cost that row its detail, not take the whole response down with a 500. The failure is logged
 *   so it is still findable.
 *
 * - `requireJsonColumn` (throws) where the value is about to be **acted on**: merged and written
 *   back, promoted into real records, or fed to the planner. A fallback there would be a silent
 *   rewrite -- a corrupt calendar merged as `{}` drops the finals window, a corrupt claim promoted
 *   with defaults becomes an assignment nobody read -- so corruption has to surface. It surfaces
 *   as the same 500 the old `JSON.parse` produced, now with a message that names the column.
 *
 * Schemas used on write paths should `.passthrough()`: anything the schema does not name is still
 * part of the stored record, and a read-modify-write must not strip it.
 */

/** Thrown by `requireJsonColumn`; the message names the column so a Worker log is actionable. */
export class JsonColumnError extends Error {
  override readonly name = "JsonColumnError";
  constructor(
    readonly column: string,
    readonly reason: string,
  ) {
    super(`Stored JSON in ${column} is unreadable: ${reason}`);
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

function attempt<S extends z.ZodTypeAny>(schema: S, text: string | null | undefined): Outcome<z.output<S>> {
  if (text === null || text === undefined || text === "") return { ok: false, reason: "empty" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: `does not match schema (${issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid"})`,
    };
  }
  return { ok: true, value: parsed.data as z.output<S> };
}

/**
 * Parses a stored JSON column for display, returning `fallback` when the text is empty, is not
 * JSON, or does not match `schema`. Never throws.
 *
 * `label` names the column in the warning logged on a fallback.
 */
export function parseJsonColumn<S extends z.ZodTypeAny>(
  schema: S,
  text: string | null | undefined,
  fallback: z.output<S>,
  label = "a JSON column",
): z.output<S> {
  const result = attempt(schema, text);
  if (result.ok) return result.value;
  console.warn(`[json-column] ${label} ${result.reason}; using fallback`);
  return fallback;
}

/**
 * Parses a stored JSON column whose value is about to be acted on. Throws `JsonColumnError` when
 * the text is empty, is not JSON, or does not match `schema`.
 *
 * Callers whose column legitimately starts empty pass `text || "{}"`, as they always did.
 */
export function requireJsonColumn<S extends z.ZodTypeAny>(
  schema: S,
  text: string | null | undefined,
  column: string,
): z.output<S> {
  const result = attempt(schema, text);
  if (result.ok) return result.value;
  throw new JsonColumnError(column, result.reason);
}

/** Any JSON object, every key kept. For records that are merged and written back whole. */
export const jsonObject = z.record(z.unknown());
