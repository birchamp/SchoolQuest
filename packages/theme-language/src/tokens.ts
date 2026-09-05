import type { ThemeName } from "@schoolquest/domain";

/**
 * Semantic keys → themed labels.
 *
 * Nothing in the database or the planning engine may use a themed word. This file is the
 * only place metaphor is allowed to exist (docs/01-product-brief.md principle 9).
 *
 * The `plain` column doubles as the accessibility label: screen readers always get plain
 * terminology even when a visual theme is active (docs/02-prd.md §5 Accessibility).
 */
export type LabelKey =
  | "term"
  | "course"
  | "majorProject"
  | "milestone"
  | "workSession"
  | "assignment"
  | "todayAction"
  | "weekMap"
  | "futureWork"
  | "prerequisite"
  | "grade"
  | "coach"
  | "startSession"
  | "inProgress"
  | "planRisk"
  | "progress"
  | "statsPage"
  | "courseTable"
  | "sharedTime"
  | "dayShape"
  | "mealBreak"
  | "weekReview"
  | "dashboard"
  | "radar"
  | "dossier"
  | "threatTier"
  | "bossEncounter"
  | "termMap"
  | "preparedFull"
  | "preparedPartial"
  | "preparedShort";

type LabelSet = Record<ThemeName, string>;

export const LABELS: Record<LabelKey, LabelSet> = {
  term: { quest: "Campaign", mission: "Deployment", plain: "Term" },
  course: { quest: "Questline", mission: "Theater", plain: "Course" },
  majorProject: { quest: "Major quest", mission: "Primary objective", plain: "Major project" },
  milestone: { quest: "Quest stage", mission: "Checkpoint", plain: "Milestone" },
  workSession: { quest: "Encounter", mission: "Sortie", plain: "Work session" },
  assignment: { quest: "Task", mission: "Assignment", plain: "Assignment" },
  todayAction: { quest: "Next move", mission: "Next action", plain: "Next action" },
  weekMap: { quest: "Region map", mission: "Operations board", plain: "Week plan" },
  futureWork: { quest: "Fog of future", mission: "Forecast", plain: "Coming up" },
  prerequisite: { quest: "Required item", mission: "Prerequisite", plain: "Prerequisite" },
  grade: { quest: "Outcome", mission: "Readout", plain: "Grade" },
  coach: { quest: "Guide", mission: "Handler", plain: "Coach" },
  startSession: { quest: "Begin encounter", mission: "Begin sortie", plain: "Start session" },
  inProgress: { quest: "Encounter underway", mission: "Sortie underway", plain: "In progress" },
  planRisk: { quest: "Hazard", mission: "Risk", plain: "Planning risk" },
  progress: { quest: "Progress", mission: "Status", plain: "Progress" },
  statsPage: { quest: "Chronicle", mission: "Readiness", plain: "Progress" },
  /**
   * The student runs every course at once out of one week — they are the DM of as many
   * campaigns as they are enrolled in, not a player in one. These two keys name that
   * surface and the pool it divides. Nothing anywhere may assume how many there are: three
   * courses and seven are both ordinary.
   */
  courseTable: { quest: "The table", mission: "Theaters", plain: "Your courses" },
  sharedTime: { quest: "Table time", mission: "Available hours", plain: "Study time" },
  /**
   * The hours around the work, and the look back at the weeks that already happened. The
   * quest wording stays on the DM's side of the table — a session has breaks in it and a
   * campaign has a recap — because the alternative reads as the app grading the student's
   * week, which is exactly what this must never be (docs/01-product-brief.md §3).
   */
  dayShape: { quest: "How the day runs", mission: "Day profile", plain: "Your day" },
  mealBreak: { quest: "Break in play", mission: "Meal window", plain: "Meal" },
  weekReview: { quest: "Last session's recap", mission: "After-action review", plain: "How last week went" },
  /** Which class needs me — the one question no other screen answers. */
  dashboard: { quest: "The war table", mission: "Status board", plain: "What needs you" },
  /**
   * The surface the term is planned from: what is coming, and whether time is set aside.
   *
   * The three preparation labels are the one place metaphor is nearly absent on purpose.
   * They are the meaning of every colour on the radar, and a student who has to translate
   * "provisioned" before they can read the board has lost the thing the board is for. The
   * plain column says it in the fewest words that are still true.
   */
  radar: { quest: "Campaign radar", mission: "Threat radar", plain: "Radar" },
  dossier: { quest: "Field notes", mission: "Dossier", plain: "Details" },
  threatTier: { quest: "Threat tier", mission: "Threat tier", plain: "Grade weight" },
  bossEncounter: { quest: "Boss", mission: "Convergence", plain: "Pile-up" },
  termMap: { quest: "Campaign map", mission: "Term map", plain: "The whole term" },
  preparedFull: { quest: "Provisioned", mission: "Provisioned", plain: "Time booked" },
  preparedPartial: { quest: "Under-planned", mission: "Under-planned", plain: "Short on time" },
  preparedShort: { quest: "Critical", mission: "Critical", plain: "Far short" },
};

export function label(key: LabelKey, theme: ThemeName): string {
  return LABELS[key][theme];
}

/** Always returns plain wording, for aria-labels and screen-reader text. */
export function plainLabel(key: LabelKey): string {
  return LABELS[key].plain;
}
