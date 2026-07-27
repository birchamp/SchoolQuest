/**
 * Prefixed identifiers. The prefix makes API payloads and audit logs readable at a
 * glance ("ws_..." is a work session, "wi_..." a work item).
 */
export const ID_PREFIXES = {
  user: "usr",
  term: "trm",
  course: "crs",
  gradingCategory: "gcat",
  meetingPattern: "mtg",
  commitment: "cmt",
  availabilityRule: "avl",
  workItem: "wi",
  dependency: "dep",
  workSession: "ws",
  gradeResult: "grd",
  planVersion: "plan",
  sourceDocument: "doc",
  extractionClaim: "clm",
  auditEvent: "aud",
  coachMessage: "msg",
  session: "sess",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
