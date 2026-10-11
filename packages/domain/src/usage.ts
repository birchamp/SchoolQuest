/**
 * The usage log's allowlist: every event the app may count, and nothing else.
 *
 * One list, shared by the web client (which only ever calls `track` with one of these) and the
 * API (which drops any name not on it). A name is a screen, a control, or a card coming into
 * view -- never a value the student typed, never a course, never an id. Adding an event means
 * adding it here, which is the review point for "is this still only counting clicks".
 *
 * See README "Usage log" for what is stored and for how long.
 */
export const USAGE_EVENTS = [
  // Tabs
  "tab.radar",
  "tab.today",
  "tab.week",
  "tab.work",
  "tab.stats",
  "tab.coach",
  "tab.setup",
  // How the week is drawn, and visual or tables
  "week_view.map",
  "week_view.calendar",
  "week_view.terrain",
  "view_mode.visual",
  "view_mode.table",
  // Cards scrolled into view (half visible, once per mount)
  "card_seen.radar",
  "card_seen.plan_changes",
  "card_seen.weekly_review",
  "card_seen.session_brief",
  "card_seen.course_table",
  "card_seen.layer_bar",
  "card_seen.week_drawing",
  "card_seen.term_map",
  "card_seen.week_table",
  "card_seen.lookahead_table",
  "card_seen.assignments_table",
  "card_seen.class_board",
  "card_seen.stats",
  "card_seen.courses_table",
  // Actions
  "session.start",
  "session.stop",
  "plan.rebuild",
  "grade.record",
  "stats.go_fix",
  "coach.send",
  "syllabus.upload",
  "theme.change",
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

const KNOWN: ReadonlySet<string> = new Set(USAGE_EVENTS);

export function isUsageEvent(name: string): name is UsageEvent {
  return KNOWN.has(name);
}

/** Most keys one report may carry. The allowlist is under it, so an honest client never meets it. */
export const USAGE_MAX_KEYS = 50;
/** Highest count accepted for one event in one report; anything above is clamped to it. */
export const USAGE_MAX_COUNT = 1000;
