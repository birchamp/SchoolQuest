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
  | "planRisk"
  | "progress";

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
  planRisk: { quest: "Hazard", mission: "Risk", plain: "Planning risk" },
  progress: { quest: "Progress", mission: "Status", plain: "Progress" },
};

export function label(key: LabelKey, theme: ThemeName): string {
  return LABELS[key][theme];
}

/** Always returns plain wording, for aria-labels and screen-reader text. */
export function plainLabel(key: LabelKey): string {
  return LABELS[key].plain;
}
