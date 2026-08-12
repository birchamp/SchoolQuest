import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * What is set up, and what is still missing, per class.
 *
 * Setup is nine cards on one long page, and the single question a student actually has while
 * working through it -- have I done this for all my classes yet -- was answered by none of them.
 * The only way to tell which of five syllabi had been uploaded was to scroll, remember, and
 * count. That is working memory doing a job a screen should do, in the one app that exists to
 * take that job off them.
 *
 * So it sits at the top of Setup and reports live. Not a progress bar: a checklist per class,
 * because "3 of 5" tells you how far along you are and not which two to open next.
 *
 * Deliberately not a blocker or a nag. Grading and meeting times are genuinely optional -- a
 * syllabus that never stated them is a fact about the syllabus, not a failure by the student --
 * so those read as dashes rather than as problems. Only a missing syllabus is called out, and
 * only because it is the one that leaves a class with no work in it at all.
 */

interface CourseReadiness {
  id: string;
  name: string;
  code: string | null;
  syllabusCount: number;
  hasMeetingTimes: boolean;
  workItemCount: number;
  gradingKnown: boolean;
}

interface Readiness {
  calendarEntries: number;
  courses: CourseReadiness[];
}

/** A tick, a dash, or a marked gap. Never colour alone: each carries a word for a reader. */
function Mark({ state, label }: { state: "yes" | "no" | "none"; label: string }) {
  const glyph = state === "yes" ? "✓" : state === "no" ? "✕" : "–";
  const color =
    state === "yes" ? "var(--safe)" : state === "no" ? "var(--at-risk)" : "var(--text-dim)";
  return (
    <span style={{ color, fontWeight: 600 }}>
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SetupStatus({ termId, refreshKey }: { termId: string; refreshKey?: number }) {
  const quest = useBodyTheme() === "quest";
  const [data, setData] = useState<Readiness | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Readiness>(`/api/terms/${termId}/readiness`));
    } catch {
      // A panel that cannot load is a panel that shows nothing, not an error on a setup page
      // that has plenty to be getting on with.
      setData(null);
    }
  }, [termId]);

  // `refreshKey` changes whenever anything on this page saves, so the counts follow the work
  // rather than needing a reload -- which is the exact staleness bug the calendar gate had.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!data) return null;

  const { courses, calendarEntries } = data;
  const withSyllabus = courses.filter((c) => c.syllabusCount > 0).length;

  return (
    <section className="card" aria-label="Setup status">
      <h2>{quest ? "The state of the campaign" : "What is set up"}</h2>

      {calendarEntries === 0 && (
        <div className="risk" data-level="watch" style={{ marginBottom: "0.7rem" }}>
          <span className="level">first</span>
          <span>
            The semester calendar is empty. Fill it in below before uploading a syllabus -- a
            syllabus says &quot;Week 14&quot; without ever saying when that is.
          </span>
        </div>
      )}

      {courses.length === 0 ? (
        <p className="muted">No classes yet. Add them below, or paste your class list.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 0.6rem" }}>
            {withSyllabus === courses.length
              ? `All ${courses.length} classes have a syllabus.`
              : `${withSyllabus} of ${courses.length} classes have a syllabus.`}
          </p>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Syllabus</th>
                  <th scope="col">Class times</th>
                  <th scope="col">Grading</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Work
                  </th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <th scope="row" style={{ fontWeight: 500, textAlign: "left" }}>
                      {/*
                        Plenty of course names already contain the code -- "General Biology I
                        (BIO 240)" -- and printing both gave "BIO 240 General Biology I (BIO
                        240)". Same guard the course list uses.
                      */}
                      {course.code ?? course.name}
                      {course.code && !course.name.includes(course.code) && (
                        <span className="muted" style={{ marginLeft: "0.4rem" }}>
                          {course.name}
                        </span>
                      )}
                    </th>
                    <td>
                      {/* The only gap marked as a problem: without one, a class has no work in
                          it at all, and an empty class looks the same as a finished one. */}
                      <Mark
                        state={course.syllabusCount > 0 ? "yes" : "no"}
                        label={course.syllabusCount > 0 ? "uploaded" : "none uploaded"}
                      />
                    </td>
                    <td>
                      <Mark
                        state={course.hasMeetingTimes ? "yes" : "none"}
                        label={course.hasMeetingTimes ? "set" : "not set"}
                      />
                    </td>
                    <td>
                      <Mark
                        state={course.gradingKnown ? "yes" : "none"}
                        label={course.gradingKnown ? "known" : "not known"}
                      />
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {course.workItemCount === 0 ? (
                        <span className="muted">none</span>
                      ) : (
                        course.workItemCount
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
            A dash means the syllabus never said, which is common and not a problem. Class times
            and grading can be filled in by hand below.
          </p>
        </>
      )}
    </section>
  );
}
