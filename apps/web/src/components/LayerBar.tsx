import type { Course, ThemeName } from "@schoolquest/domain";
import { courseChipFill } from "../lib/course-colour";
import type { CourseHealthView, PlanResponse } from "../lib/types";

/**
 * One switch per class, governing every card on the week.
 *
 * ## Why layers and not five maps
 *
 * Time is the shared resource. If BIO's work lived on BIO's own map, nothing would ever show
 * that Wednesday is already full of HIS, and that collision *is* the problem this app exists
 * for. One piece of ground, and you choose what stands on it.
 *
 * ## Why switching off does two different things
 *
 * On the **road ahead**, off means gone: the ground there is *built from* the work, and there is
 * no such thing as a receded mountain. Rebuilding the relief from what is switched on is the
 * whole point — "what does my month look like if I only look at BIO".
 *
 * Everywhere else, off means **stepped back, never removed**. This is the important half. The
 * hour-by-hour calendar shows time already committed, and hiding a class there would invent free
 * time that does not exist — a student with time blindness would look at Wednesday, see a gap,
 * and plan into an hour that is already taken. The week map and the arc are the same argument
 * one step weaker: work you cannot see is work you will forget, and for the reader this is built
 * for, out of sight is not a figure of speech.
 *
 * ## Why this never persists
 *
 * Layer state resets to all-on every visit, deliberately. The worst outcome this control can
 * produce is switching four classes off, being distracted, and coming back next week to an app
 * that quietly under-reports the term. A filter that survives a session is exactly how a class
 * gets lost, so this one does not.
 *
 * ## Why a switched-off class keeps its severity
 *
 * That is the argument for putting these here at all rather than leaving the lens buried as a
 * roster row click. Turning HIS off has to quieten the picture without quietening HIS.
 *
 * The severity is read from the course-health engine rather than from what happens to be on the
 * map, because a class can be in trouble for reasons no map can draw — a grade below target, a
 * result that came back and was never recorded, a grading scheme that does not add up. A switch
 * counting only lit beacons would go calm on exactly those.
 */

/** Quest's parchment values, measured on that card. See `Dashboard.tsx` for why they differ. */
const QUEST_INK_DIM = "#5b4930";
const QUEST_WAX = "#8c2f28";
const QUEST_GOLD_DIM = "#6f5200";

/**
 * The severity a class is carrying, in the same language the dashboard uses.
 *
 * Quest repaints the ground under these cards, so it needs its own values — `--at-risk` on
 * parchment measured 1.99:1 the last time a component assumed otherwise. The rule this keeps
 * failing to make obvious: a theme that repaints the ground has to repaint every token that
 * means "text on the ground", every time, and the only way to know it did is to measure.
 */
export function levelColour(level: string, quest: boolean): string {
  if (!quest) {
    return level === "at_risk"
      ? "var(--at-risk)"
      : level === "needs_attention"
        ? "var(--watch)"
        : "var(--text-dim)";
  }
  return level === "at_risk" ? QUEST_WAX : level === "needs_attention" ? QUEST_GOLD_DIM : QUEST_INK_DIM;
}

/** Never colour alone: every severity ships a mark and a word as well as a hue. */
const LEVEL_MARK: Record<string, { glyph: string; word: string }> = {
  at_risk: { glyph: "▲", word: "needs a decision" },
  needs_attention: { glyph: "●", word: "needs attention" },
  steady: { glyph: "·", word: "steady" },
};

export interface Layer {
  course: Course;
  on: boolean;
  level: string;
  concern: string | null;
  /** Open work in this class with nothing booked for it, or already past its date. */
  lit: number;
}

/** What each class is carrying, whether or not it is currently drawn. */
export function buildLayers(plan: PlanResponse, hidden: ReadonlySet<string>): Layer[] {
  const health = new Map<string, CourseHealthView>(
    (plan.health?.courses ?? []).map((c) => [c.courseId, c]),
  );
  return plan.courses.map((course) => ({
    course,
    on: !hidden.has(course.id),
    level: health.get(course.id)?.level ?? "steady",
    concern: health.get(course.id)?.concerns[0]?.detail ?? null,
    lit: health.get(course.id)?.concerns.length ?? 0,
  }));
}

export function LayerBar({
  layers,
  theme,
  onToggle,
  onAll,
}: {
  layers: Layer[];
  theme: ThemeName;
  onToggle: (courseId: string) => void;
  onAll: () => void;
}) {
  const quest = theme === "quest";
  const off = layers.filter((l) => !l.on);

  return (
    <div className="terrain-layers">
      <ul aria-label="Classes shown">
        {layers.map(({ course, on, level, concern, lit }) => {
          const mark = LEVEL_MARK[level] ?? LEVEL_MARK.steady!;
          return (
            <li key={course.id}>
              <button
                type="button"
                className={`terrain-layer${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => onToggle(course.id)}
                title={concern ?? `${course.name} — ${mark.word}`}
              >
                <span
                  aria-hidden="true"
                  className="terrain-layer-swatch"
                  style={{ background: courseChipFill(course.id, course.colorToken) }}
                />
                <span className="terrain-layer-code">{course.code ?? course.name}</span>
                <span aria-hidden="true" style={{ color: levelColour(level, quest), fontWeight: 700 }}>
                  {mark.glyph}
                </span>
                {lit > 0 && (
                  <span aria-hidden="true" className="terrain-layer-count">
                    {lit}
                  </span>
                )}
                <span className="sr-only">
                  {course.name}: {mark.word}
                  {lit > 0 ? `, ${lit} ${lit === 1 ? "thing" : "things"} to sort out` : ""}.{" "}
                  {on ? "Switched on. Activate to switch off." : "Switched off. Activate to switch on."}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {off.length > 0 && (
        <button type="button" className="terrain-layer-all" onClick={onAll}>
          Switch every class back on
        </button>
      )}
      {/* The rule, stated rather than left to be inferred from watching two cards behave
          differently. It is short because it has to survive being read once. */}
      <p className="terrain-layers-note">
        {off.length === 0
          ? "Switch a class off to clear it from the road ahead. It only steps back on the other cards — nothing here ever hides your committed time."
          : `${off.map((l) => l.course.code ?? l.course.name).join(", ")} ${off.length === 1 ? "is" : "are"} off: cleared from the road ahead, stepped back elsewhere. Still counted, still listed.`}
      </p>
    </div>
  );
}
