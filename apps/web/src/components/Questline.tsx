import { colorTokenFor, type Course, type CourseColorToken, type ThemeName } from "@schoolquest/domain";
import type { CourseProgressView, TermProgressView } from "../lib/types";

/**
 * Per-course progress readout (packages/planning-engine/src/progress.ts).
 *
 * The engine already refuses to invent numbers; this view's whole job is to not undo that
 * on the way to the screen. Three rules drive every branch below:
 *
 * 1. `basis === "items"` means the syllabus never stated point values for that course, so
 *    no points/XP figure may appear on that row at all — not even "0 of 0".
 * 2. `pointsCoverage < 1` means the point total is a floor. It is marked once, in a
 *    footnote, rather than shouted on every row.
 * 3. `itemsTotal === 0` is a course with nothing in it yet, which is a true statement about
 *    the term — it gets a sentence, not a 0% bar implying the student is behind.
 *
 * Quest chrome is presentation only: the numbers, the ordering, and the screen-reader text
 * are identical under every theme (docs/01-product-brief.md principle 9).
 */

/**
 * Quest palette, duplicated from the `--q-*` custom properties in styles.css as literals.
 * Inline styles here are only ever applied when `theme === "quest"`, but hard-coding the
 * hex keeps the component readable in isolation and matches how Today.tsx does it.
 */
const Q = {
  ink: "#2a1f14",
  parchment: "#efe3c8",
  leather: "#17110a",
  gold: "#c9a227",
  goldBright: "#e8c95a",
  goldDim: "#8a6f1f",
  wax: "#8c2f28",
} as const;

/**
 * Heraldic tinctures for course sigils. All are dark enough to carry parchment-colored
 * initials at 4.5:1, because the sigil is a filled chip and color is never load-bearing on
 * its own — the course name sits immediately beside it.
 */
const HERALDRY: Record<CourseColorToken, string> = {
  azure: "#2f4a6d",
  vermilion: "#8c2f28",
  verdant: "#3f6c45",
  amber: "#6b4a2a",
  violet: "#5a3b6b",
  sable: "#241a10",
};

/** Locale-formatted, but never rounded up into a friendlier number. */
function num(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Floors rather than rounds: 99.6% must not read as "100%" when work remains. Understating
 * by less than a point is the only direction this is allowed to be wrong in.
 */
function percentOf(fraction: number): number {
  return Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
}

/** Course code appended only when the name does not already carry it (see WeekMap). */
function courseLabel(course: Course | undefined, courseId: string): string {
  if (!course) return `Course ${courseId.slice(0, 6)}`;
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

/**
 * Sigil lettering. Digits are skipped on purpose: "BIO 240" as a two-character mark reads
 * as "B2", which looks like a typo rather than a course.
 */
function initialsFor(course: Course | undefined, courseId: string): string {
  const source = course?.code ?? course?.name ?? courseId;
  const words = source.match(/[A-Za-z]+/g) ?? [];
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return (second ? first.slice(0, 1) + second.slice(0, 1) : first.slice(0, 3)).toUpperCase();
}

/**
 * Themed wording on screen, plain wording for assistive tech. Screen-reader output must
 * never depend on the visual theme (docs/02-prd.md §5 Accessibility).
 */
function Themed({ visible, plain }: { visible: string; plain: string }) {
  if (visible === plain) return <>{visible}</>;
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{plain}</span>
    </>
  );
}

/**
 * A progress track. Reuses `.capacity-bar` so it inherits the shipped bar geometry, and
 * overrides inline for the quest theme's inlaid-groove look. The meter carries the entire
 * statement in plain language, which is why the visible numerals beside it are aria-hidden:
 * announcing both would read the row twice.
 */
function Track({
  percent,
  ariaLabel,
  quest,
  emphasis,
}: {
  percent: number;
  ariaLabel: string;
  quest: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className="capacity-bar"
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={
        quest
          ? {
              position: "relative",
              height: emphasis ? 14 : 10,
              borderRadius: 4,
              margin: "0.45rem 0 0.3rem",
              background: "linear-gradient(180deg, #100b06, #291e12)",
              border: `1px solid ${Q.goldDim}`,
              boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.65)",
            }
          : {
              height: emphasis ? 10 : 8,
              borderRadius: 5,
              margin: "0.45rem 0 0.3rem",
            }
      }
    >
      <span
        style={
          quest
            ? {
                width: `${percent}%`,
                background: "linear-gradient(180deg, #f2dc8a, #c9a227 50%, #8a6f1f)",
                boxShadow: "0 0 9px rgba(201, 162, 39, 0.5)",
              }
            : // The term track is the one bar that carries the full accent, so the roster
              // below it reads as detail rather than four competing headlines.
              { width: `${percent}%`, background: emphasis ? "var(--accent)" : undefined }
        }
      />
      {/* Ten notches, so the track reads as a measured campaign scale rather than a smear. */}
      {quest && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(90deg, rgba(15, 10, 5, 0.55) 0 1px, transparent 1px 10%)",
          }}
        />
      )}
    </div>
  );
}

/** One labelled figure in the term banner. Label and value are always paired. */
function Stat({ caption, value, quest }: { caption: string; value: string; quest: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.63rem",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: quest ? "#cbb98c" : "var(--text-dim)",
        }}
      >
        {caption}
      </div>
      <div
        style={{
          fontSize: "1.05rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: quest ? Q.parchment : "var(--text)",
          marginTop: "0.1rem",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function Questline({
  progress,
  courses,
  theme,
}: {
  progress: TermProgressView;
  courses: Course[];
  theme: ThemeName;
}): JSX.Element {
  const quest = theme === "quest";
  const coursesById = new Map(courses.map((c) => [c.id, c]));

  // `label()` covers the nouns but not these phrasings, and Plain must not inherit a
  // metaphor from either of the other two shells.
  // Distinct from the persistent term strip on the Today view, which states the same
  // totals in one line. This card is the per-course ledger behind that number, so it is
  // named for the rows rather than for the summary.
  const heading = quest
    ? "Questlines"
    : theme === "mission"
      ? "Theaters"
      : "Course progress";

  const termPercent = percentOf(progress.completionFraction);
  // Not `pointsTotal > 0`. In the five-course test semester exactly one item carried a
  // point value, which made that stat read "100 / 100 XP banked" beside "6 of 56 tasks" —
  // a term that looks finished and is 10% done. The engine already decides when points
  // are representative; this defers to that decision rather than to whether any exist.
  const termHasPoints = progress.basis === "points";
  // No work anywhere yet: a percentage and a "0 of 0" would both be noise dressed as data.
  const termEmpty = progress.itemsTotal === 0;
  const partialCourses = progress.courses.filter(
    (c) => c.basis === "points" && c.pointsCoverage < 1,
  ).length;
  const taskCountedCourses = progress.courses.filter(
    (c) => c.basis === "items" && c.itemsTotal > 0,
  ).length;

  const termAriaLabel = [
    `Term progress: ${termPercent} percent complete`,
    termHasPoints ? `${num(progress.pointsDone)} of ${num(progress.pointsTotal)} points` : null,
    `${progress.itemsDone} of ${progress.itemsTotal} required tasks finished`,
  ]
    .filter(Boolean)
    .join(", ");

  if (progress.courses.length === 0) {
    return (
      <section className="card" aria-labelledby="questline-heading">
        <h2 id="questline-heading">
          {quest && <span aria-hidden="true">{"⚜ "}</span>}
          {heading}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          <Themed
            visible={
              quest
                ? "No questlines yet. Add a course and its work will be charted here."
                : "No courses yet. Add a course and its work will appear here."
            }
            plain="No courses yet. Add a course and its work will appear here."
          />
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="questline-heading">
      <h2 id="questline-heading">
        {quest && <span aria-hidden="true">{"⚜ "}</span>}
        {heading}
      </h2>

      {/* Flavor is quest-only and says nothing the numbers do not (cf. WeekMap). */}
      {quest && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          Every questline keeps its own ledger. What is banked is banked; the rest still
          lies ahead of you.
        </p>
      )}

      {/* ---- Term banner: the whole campaign in one line, stated once. ---- */}
      <div
        style={
          quest
            ? {
                position: "relative",
                margin: "0 0 1rem",
                padding: "0.8rem 1rem 0.9rem",
                borderRadius: 5,
                color: Q.parchment,
                background: `linear-gradient(180deg, #2c2013, ${Q.leather})`,
                border: `1px solid ${Q.goldDim}`,
                boxShadow:
                  "inset 0 1px 0 rgba(232, 201, 90, 0.18), 0 2px 10px rgba(0, 0, 0, 0.45)",
              }
            : {
                margin: "0 0 0.9rem",
                padding: "0.75rem 0.9rem 0.85rem",
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }
        }
      >
        {quest && (
          <>
            <span
              aria-hidden="true"
              style={{ position: "absolute", top: 4, left: 7, color: Q.goldDim, fontSize: "0.6rem" }}
            >
              ❖
            </span>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: 4,
                right: 7,
                color: Q.goldDim,
                fontSize: "0.6rem",
              }}
            >
              ❖
            </span>
          </>
        )}

        {termEmpty ? (
          <p style={{ margin: 0, fontSize: "0.92rem", color: quest ? "#d9c79b" : "var(--text-dim)" }}>
            <Themed
              visible={
                quest
                  ? "Nothing charted yet across your questlines."
                  : "No work items have been added to your courses yet."
              }
              plain="No work items have been added to your courses yet."
            />
          </p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "1.25rem",
                flexWrap: "wrap",
              }}
            >
              <div aria-hidden="true">
                <div
                  style={{
                    fontSize: "2.15rem",
                    lineHeight: 1,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: quest ? Q.goldBright : "var(--text)",
                    textShadow: quest ? "0 1px 0 rgba(0, 0, 0, 0.85)" : undefined,
                  }}
                >
                  {termPercent}%
                </div>
                <div
                  style={{
                    marginTop: "0.3rem",
                    fontSize: "0.66rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    color: quest ? "#cbb98c" : "var(--text-dim)",
                  }}
                >
                  {quest ? "of the campaign complete" : "of term work complete"}
                </div>
              </div>

              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }} aria-hidden="true">
                {/* Points only exist here when at least one course actually stated them. */}
                {termHasPoints && (
                  <Stat
                    quest={quest}
                    caption={quest ? "XP banked" : "Points complete"}
                    value={`${num(progress.pointsDone)} / ${num(progress.pointsTotal)}`}
                  />
                )}
                <Stat
                  quest={quest}
                  caption={quest ? "Tasks cleared" : "Tasks complete"}
                  value={`${progress.itemsDone} / ${progress.itemsTotal}`}
                />
              </div>
            </div>

            <Track quest={quest} emphasis percent={termPercent} ariaLabel={termAriaLabel} />
          </>
        )}
      </div>

      {/* ---- Roster: one row per course, in the order the term lists them. ---- */}
      <div
        className="muted"
        style={{
          fontSize: "0.66rem",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          borderBottom: quest ? "1px solid rgba(138, 111, 31, 0.38)" : "1px solid var(--border)",
          paddingBottom: "0.3rem",
          marginBottom: "0.15rem",
        }}
      >
        {/* Not "Questlines" — that is the card's own heading, and repeating it read as a
            rendering fault rather than a section break. */}
        <Themed visible={quest ? "The roster" : "By course"} plain="By course" />
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {progress.courses.map((cp: CourseProgressView, index) => {
          const course = coursesById.get(cp.courseId);
          const name = courseLabel(course, cp.courseId);
          // Keyed on the course's own identity colour, not its position in this list, so
          // a course keeps its tincture wherever it appears. Position-keyed colour meant
          // the same course changed hue between screens that happened to sort differently.
          const tincture = HERALDRY[colorTokenFor(cp.courseId, course?.colorToken)];
          const empty = cp.itemsTotal === 0;
          const points = cp.basis === "points";
          const partial = points && cp.pointsCoverage < 1;
          const percent = percentOf(cp.completionFraction);

          const readout = points
            ? quest
              ? `${num(cp.pointsDone)} / ${num(cp.pointsTotal)} XP`
              : `${num(cp.pointsDone)} of ${num(cp.pointsTotal)} points`
            : `${cp.itemsDone} of ${cp.itemsTotal} tasks`;

          const ariaLabel = points
            ? `${name}: ${percent} percent complete, ${num(cp.pointsDone)} of ${num(
                cp.pointsTotal,
              )} points finished, ${cp.itemsDone} of ${cp.itemsTotal} required tasks done${
                partial ? ", and some required items in this course state no point value" : ""
              }`
            : `${name}: ${percent} percent complete, ${cp.itemsDone} of ${cp.itemsTotal} required tasks finished, counted by task because this course states no point values`;

          return (
            <li
              key={cp.courseId}
              style={{
                padding: "0.7rem 0",
                borderTop:
                  index === 0
                    ? "none"
                    : quest
                      ? "1px solid rgba(138, 111, 31, 0.38)"
                      : "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 30,
                    height: 30,
                    flex: "0 0 auto",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: quest ? 4 : 8,
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    letterSpacing: "0.03em",
                    background: quest
                      ? `linear-gradient(160deg, rgba(255, 255, 255, 0.16), rgba(0, 0, 0, 0.3)), ${tincture}`
                      : "var(--surface-2)",
                    border: quest ? `1px solid ${Q.goldDim}` : "1px solid var(--border)",
                    color: quest ? "#f4ead2" : "var(--text-dim)",
                    boxShadow: quest ? "inset 0 1px 0 rgba(255, 255, 255, 0.15)" : undefined,
                  }}
                >
                  {initialsFor(course, cp.courseId)}
                </span>

                <span
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    fontWeight: 600,
                    fontSize: "0.98rem",
                    color: quest ? Q.ink : "var(--text)",
                  }}
                >
                  {name}
                </span>

                {/* Hidden from assistive tech: the meter below states the same figures in
                    plain language, and announcing both reads every row twice. */}
                {!empty && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.45rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {points && quest ? (
                      <span
                        style={{
                          border: `1px solid ${Q.gold}`,
                          borderRadius: 4,
                          padding: "0.08rem 0.45rem",
                          background: "rgba(201, 162, 39, 0.25)",
                          color: Q.ink,
                          fontWeight: 700,
                          fontSize: "0.8rem",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        <span aria-hidden="true">{"✦ "}</span>
                        {readout}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "0.84rem",
                          fontVariantNumeric: "tabular-nums",
                          color: quest ? "#5b4930" : "var(--text-dim)",
                        }}
                      >
                        {readout}
                      </span>
                    )}
                    {partial && (
                      <span style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>◇</span>
                    )}
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "0.9rem",
                        fontVariantNumeric: "tabular-nums",
                        color: quest ? Q.wax : "var(--text)",
                        minWidth: "2.6rem",
                        textAlign: "right",
                      }}
                    >
                      {percent}%
                    </span>
                  </span>
                )}
              </div>

              {/* Bars and captions hang under the name, clear of the sigil gutter. */}
              <div style={{ marginLeft: 38 }}>
                {empty ? (
                  <p
                    className="muted"
                    style={{ margin: "0.35rem 0 0", fontStyle: quest ? "italic" : undefined }}
                  >
                    <Themed
                      visible={quest ? "Nothing charted yet." : "No items added yet."}
                      plain="No work items in this course yet."
                    />
                  </p>
                ) : (
                  <>
                    <Track quest={quest} percent={percent} ariaLabel={ariaLabel} />
                    {/* Only points rows get a caption. On task-counted rows the readout
                        above already says "3 of 9 tasks", and repeating why on every row
                        put the same sentence on screen five times. It is said once below. */}
                    {points && (
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.8rem" }}
                        aria-hidden="true"
                      >
                        {`${cp.itemsDone} of ${cp.itemsTotal} tasks ${quest ? "cleared" : "done"}`}
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Why some rows count tasks instead of points — stated once for the whole card. */}
      {taskCountedCourses > 0 && (
        <p className="muted" style={{ margin: "0.85rem 0 0", fontSize: "0.8rem" }}>
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"◇ "}
          </span>
          <Themed
            visible={
              taskCountedCourses === progress.courses.length
                ? "Counted by task: these syllabi state grading weights rather than point values, so progress is measured in work finished."
                : "Counted by task where a syllabus states grading weights rather than point values."
            }
            plain="Counted by task: these syllabi state grading weights rather than per-assignment point values, so progress is measured in work finished."
          />
        </p>
      )}

      {/* Stated once, not per row: the marked totals are a floor, not the full tally. */}
      {partialCourses > 0 && (
        <p className="muted" style={{ margin: "0.85rem 0 0", fontSize: "0.8rem" }}>
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"◇ "}
          </span>
          <Themed
            visible={
              quest
                ? "Partial point data: some items in these questlines state no point value, so the XP totals are a floor, not the full tally."
                : "Partial point data: some items in these courses state no point value, so the point totals are a floor, not the full total."
            }
            plain="Partial point data: some required items in these courses state no point value, so the point totals shown are a floor, not the full total."
          />
        </p>
      )}

      <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
        <Themed
          visible={
            quest
              ? "Nothing here fades on an idle day — an unfilled track is simply what is left to do."
              : "Nothing here decreases over time. An unfilled bar is simply work that is still ahead."
          }
          plain="Nothing here decreases over time. An unfilled bar is simply work that is still ahead."
        />
      </p>
    </section>
  );
}
