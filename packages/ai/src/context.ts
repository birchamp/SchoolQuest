import type { Course, CourseStanding, WorkItem } from "@schoolquest/domain";
import type { PlanningResult } from "@schoolquest/planning-engine";
import { explainReason, explainRisk } from "@schoolquest/theme-language";

/**
 * Renders the current plan into the compact text block the coach reasons over.
 *
 * The coach is grounded, not creative: it may only restate what appears here. Reasons
 * arrive pre-rendered from the deterministic reason-code table so the model paraphrases
 * the planner's actual justification rather than inventing a plausible one.
 */

export interface CoachContextInput {
  now: string;
  timezone: string;
  plan: PlanningResult;
  workItems: WorkItem[];
  courses: Course[];
  standings?: Record<string, CourseStanding>;
}

export interface CoachContext {
  text: string;
  sessionIds: Set<string>;
  workItemIds: Set<string>;
}

export function buildCoachContext(input: CoachContextInput): CoachContext {
  const itemsById = new Map(input.workItems.map((w) => [w.id, w]));
  const coursesById = new Map(input.courses.map((c) => [c.id, c]));
  const today = input.now.slice(0, 10);

  const lines: string[] = [];
  lines.push(`Current time: ${input.now} (${input.timezone})`);
  lines.push("");

  // --- Today's recommendations, in order.
  lines.push("RECOMMENDED NEXT ACTIONS (in order):");
  if (input.plan.recommendations.length === 0) {
    lines.push("  (nothing scheduled for the rest of today)");
  }
  for (const rec of input.plan.recommendations) {
    const course = coursesById.get(rec.courseId);
    const reasons = rec.reasonCodes.map((c) => explainReason(c)).join("; ");
    lines.push(
      `  [${rec.sessionId}] ${rec.title} (${course?.name ?? "Unknown course"}) - ` +
        `${rec.durationMinutes} min at ${rec.startAt.slice(11, 16)}. Why: ${reasons}`,
    );
  }
  lines.push("");

  // --- The rest of today, then the week ahead in less detail.
  const todaySessions = input.plan.sessions.filter((s) => s.startAt.slice(0, 10) === today);
  lines.push(`TODAY'S FULL SCHEDULE (${todaySessions.length} sessions):`);
  for (const session of todaySessions) {
    const item = itemsById.get(session.workItemId);
    lines.push(
      `  [${session.id}] ${session.startAt.slice(11, 16)}-${session.endAt.slice(11, 16)} ` +
        `${item?.title ?? "Session"} (${session.minutes} min)${session.locked ? " [locked]" : ""}`,
    );
  }
  lines.push("");

  lines.push("REST OF THE WEEK (protected later, do not re-plan casually):");
  const laterByDay = new Map<string, string[]>();
  for (const session of input.plan.sessions) {
    const date = session.startAt.slice(0, 10);
    if (date <= today) continue;
    const item = itemsById.get(session.workItemId);
    const entry = `${item?.title ?? "Session"} (${session.minutes} min)`;
    const list = laterByDay.get(date);
    if (list) list.push(entry);
    else laterByDay.set(date, [entry]);
  }
  for (const [date, entries] of [...laterByDay].sort()) {
    lines.push(`  ${date}: ${entries.join(", ")}`);
  }
  if (laterByDay.size === 0) lines.push("  (nothing else scheduled this week)");
  lines.push("");

  // --- Deadlines the student may be about to trade against.
  const upcoming = input.workItems
    .filter((w) => w.dueAt && w.status !== "completed" && w.status !== "submitted")
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .slice(0, 8);
  lines.push("UPCOMING DEADLINES:");
  for (const item of upcoming) {
    const course = coursesById.get(item.courseId);
    const points = item.pointsPossible !== null ? `, ${item.pointsPossible} points` : "";
    const confidence =
      item.sourceConfidence === "confirmed" ? "" : ` [${item.sourceConfidence.replace("_", " ")}]`;
    lines.push(
      `  [${item.id}] ${item.title} (${course?.name ?? "?"}) due ${item.dueAt!.slice(0, 16).replace("T", " ")}${points}${confidence}`,
    );
  }
  lines.push("");

  // --- Capacity and risk: the "is the rest still safe?" half of the product promise.
  const { usedMinutes, availableMinutes } = input.plan.capacity;
  lines.push(
    `CAPACITY THIS WEEK: ${usedMinutes} of ${availableMinutes} available minutes are scheduled.`,
  );

  // How that one pool is divided. Without this the coach can be told to name what more time
  // on one course costs elsewhere, and have no way to honour it — it would either stay vague
  // or invent a figure. With it, "History already holds a quarter of your week" is a fact it
  // can read off rather than guess at.
  const minutesByCourse = new Map<string, number>();
  for (const session of input.plan.sessions) {
    const courseId = itemsById.get(session.workItemId)?.courseId;
    if (!courseId) continue;
    minutesByCourse.set(courseId, (minutesByCourse.get(courseId) ?? 0) + session.minutes);
  }
  if (minutesByCourse.size > 0) {
    const totalBooked = [...minutesByCourse.values()].reduce((sum, m) => sum + m, 0);
    lines.push("HOW THIS WEEK IS DIVIDED (one pool of time, every course drawing on it):");
    for (const course of input.courses) {
      const minutes = minutesByCourse.get(course.id) ?? 0;
      const share = totalBooked > 0 ? Math.round((minutes / totalBooked) * 100) : 0;
      lines.push(
        `  ${course.name}: ${minutes} minutes (${share}% of what is booked)` +
          (minutes === 0 ? " — nothing booked this week" : ""),
      );
    }
  }

  if (input.plan.risks.length > 0) {
    lines.push("PLANNING RISKS:");
    for (const risk of input.plan.risks.slice(0, 6)) {
      const item = risk.workItemId ? itemsById.get(risk.workItemId) : null;
      lines.push(`  ${risk.level}: ${explainRisk(risk.code)}${item ? ` (${item.title})` : ""}`);
    }
  }

  if (input.plan.unscheduledWorkItemIds.length > 0) {
    const titles = input.plan.unscheduledWorkItemIds
      .map((id) => itemsById.get(id)?.title)
      .filter(Boolean);
    lines.push(`NOT YET FITTED INTO THIS WEEK: ${titles.join(", ")}`);
  }
  lines.push("");

  // --- Course standing, stated as opportunity rather than judgement (docs/04 §7).
  if (input.standings) {
    lines.push("COURSE STANDING:");
    for (const course of input.courses) {
      const standing = input.standings[course.id];
      if (!standing) continue;
      if (standing.estimatedPercent === null) {
        lines.push(`  ${course.name}: not enough graded work yet to estimate.`);
      } else {
        lines.push(
          `  ${course.name}: about ${standing.estimatedPercent.toFixed(0)}% ` +
            `(${standing.confidence.replace("_", " ")}), ` +
            `${(standing.remainingWeightFraction * 100).toFixed(0)}% of the grade still ahead.`,
        );
      }
    }
  }

  return {
    text: lines.join("\n"),
    sessionIds: new Set(input.plan.sessions.map((s) => s.id)),
    workItemIds: new Set(input.workItems.map((w) => w.id)),
  };
}
