import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * Everything nobody has answered about this term, and the message to send about it.
 *
 * ## The problem this solves is findability, not capability
 *
 * The app already asks good questions. It asks them in five different places: clarification
 * questions inside whichever document review raised them, undated work only in the assignments
 * table, unweighted categories nowhere at all, extracted policies on no screen whatsoever. On
 * the five-course test term that is seven screens to see what is still unknown, and the reader
 * this product is built for (docs/01-product-brief.md) will visit none of them.
 *
 * So this is the index: one list, grouped by course, ordered by what the gap costs.
 *
 * ## The draft is the point
 *
 * "Ask your professor when the second paper is due" sounds like one action. For someone with
 * executive-function difficulty it is four — decide what to ask, phrase it politely, find the
 * address, start the message — and the question dies at whichever one is hardest that day.
 *
 * A written message removes all four. Copy, paste, send. It is the same move the effort survey
 * already makes with `askProfessor`, applied to every kind of gap and gathered per course, so
 * five questions become one email rather than five.
 *
 * ## What it deliberately does not do
 *
 * It does not answer anything. Answering happens where answering happens — the review panel,
 * the assignments table, the effort survey — because two places that write the same claim is
 * two sources of truth for it. This reads, lists, and hands over a sentence.
 */

interface OpenQuestion {
  id: string;
  courseId: string;
  kind:
    | "missing_due_date"
    | "unanswered_clarification"
    | "unknown_weight"
    | "weights_incomplete"
    | "unread_policy";
  question: string;
  stakes: string;
  askProfessor: string;
  sendable: boolean;
  workItemIds: string[];
  /** The syllabus lines behind the question, when it came from a document. */
  evidence?: { page: number; excerpt: string }[];
}

interface CourseQuestions {
  courseId: string;
  courseLabel: string;
  instructor: string | null;
  questions: OpenQuestion[];
  draftMessage: string;
}

interface OpenQuestionsResult {
  courses: CourseQuestions[];
  questionCount: number;
  coursesAffected: number;
}

/** Themed wording on screen, plain wording for assistive technology (docs/02-prd.md §5). */
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
 * A short label for the kind of gap, so a reader scanning the list can tell at a glance whether
 * this is a missing date or a policy to confirm without reading the sentence.
 */
const KIND_LABEL: Record<OpenQuestion["kind"], string> = {
  missing_due_date: "No date",
  unanswered_clarification: "Unanswered",
  unknown_weight: "No weight",
  weights_incomplete: "Weights short",
  unread_policy: "Policy",
};

/**
 * Where the answer to each kind of question is typed in. Every question the list raises has
 * a place its answer lands -- the whole point of listing it was to get it answered -- so the
 * list stops at the door rather than at the diagnosis, the same lesson the readiness board
 * had to learn.
 */
type AnswerRoute = { tab: string; elementId?: string; label: string };

function answerRoute(q: OpenQuestion): AnswerRoute | null {
  switch (q.kind) {
    case "missing_due_date":
      // Straight to the row whose date is missing, where the date input sits.
      return q.workItemIds[0]
        ? { tab: "work", elementId: `work-item-${q.workItemIds[0]}`, label: "Enter the date" }
        : { tab: "work", label: "Open the assignments" };
    case "unknown_weight":
    case "weights_incomplete":
      // Category weights live in the course manager's grading editor.
      return { tab: "setup", elementId: "course-manager", label: "Enter the weights" };
    case "unread_policy":
      return { tab: "setup", elementId: "course-manager", label: "Confirm it on the class" };
    case "unanswered_clarification":
      // Answered inside the document's review flow, reached from the syllabus card.
      return { tab: "setup", elementId: "syllabus-upload", label: "Answer in review" };
    default:
      return null;
  }
}

export function OpenQuestions({
  termId,
  onAnswer,
}: {
  termId: string;
  /** Take the student to where a question's answer is typed in. */
  onAnswer?: (tab: string, elementId?: string) => void;
}) {
  const theme = useBodyTheme();
  const quest = theme === "quest";

  const [result, setResult] = useState<OpenQuestionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setResult(await api.get<OpenQuestionsResult>(`/api/terms/${termId}/open-questions`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load what is still open.");
    }
  }, [termId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(course: CourseQuestions) {
    try {
      await navigator.clipboard.writeText(course.draftMessage);
      setCopied(course.courseId);
    } catch {
      // Clipboard access can be refused outright. Showing the message is the fallback that
      // still works, so the student can select it themselves rather than being told "no".
      setOpenCourseId(course.courseId);
      setError("Copying was blocked, so the message is shown below — select it and copy.");
    }
  }

  if (error && !result) {
    return (
      <section className="card">
        <h2>Still unanswered</h2>
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!result) return null;

  if (result.questionCount === 0) {
    /**
     * Said out loud rather than by absence. "Nothing is open" is genuine news on a term with
     * five syllabi in it, and a card that silently disappears reads as a card that broke.
     */
    return (
      <section className="card">
        <h2>
          <Themed visible={quest ? "Nothing left to ask" : "Nothing unanswered"} plain="Nothing unanswered" />
        </h2>
        <p className="muted">
          Every assignment has a date, every category has a weight, and no question is waiting on
          an answer.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>
        <Themed
          visible={quest ? "Riddles unanswered" : "Still unanswered"}
          plain="Still unanswered"
        />
      </h2>
      <p className="muted">
        {result.questionCount === 1
          ? "One thing about this term nobody has answered"
          : `${result.questionCount} things about this term nobody has answered`}
        {result.coursesAffected === 1 ? ", in one course." : `, across ${result.coursesAffected} courses.`}{" "}
        Most have a message written and ready to send; the ones marked{" "}
        <em>yours to settle</em> are ones only you can answer.
      </p>

      {error && <p className="error">{error}</p>}

      {result.courses.map((course) => (
        <div key={course.courseId} className="question-course">
          <h3>{course.courseLabel}</h3>
          <ul className="question-list">
            {course.questions.map((question) => (
              <li key={question.id}>
                {/* A question that would be meaningless in an email says so, rather than
                    quietly not appearing in the draft and leaving the reader to wonder. */}
                <span className="question-kind">
                  {question.sendable ? KIND_LABEL[question.kind] : "Yours to settle"}
                </span>
                <span className="question-text">{question.question}</span>
                {/* Why it matters, in what it costs — never "for accuracy", which is a reason
                    for the app rather than a reason for the student. */}
                {question.stakes && <span className="question-stakes muted">{question.stakes}</span>}
                {onAnswer && answerRoute(question) && (
                  <span style={{ display: "block", marginTop: "0.35rem" }}>
                    <button
                      className="action"
                      onClick={() => {
                        const r = answerRoute(question)!;
                        onAnswer(r.tab, r.elementId);
                      }}
                    >
                      {answerRoute(question)!.label}
                    </button>
                  </span>
                )}
                {question.evidence?.length ? (
                  /* The line the question came from. Without it the student is asked to confirm
                     something they have no way to look up short of reopening the PDF -- and has
                     no way to notice the app misread it. */
                  <blockquote
                    style={{
                      margin: "0.3rem 0 0",
                      padding: "0.3rem 0.55rem",
                      borderLeft: "3px solid var(--accent-dim)",
                      background: "var(--surface-2)",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      fontSize: "0.78rem",
                      lineHeight: 1.4,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {question.evidence[0]!.excerpt}
                    <cite
                      className="muted"
                      style={{ display: "block", fontStyle: "normal", fontSize: "0.7rem", marginTop: "0.15rem" }}
                    >
                      page {question.evidence[0]!.page}
                    </cite>
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="button-row">
            <button
              className="action primary"
              disabled={course.draftMessage === ""}
              onClick={() => void copy(course)}
            >
              {copied === course.courseId
                ? "Copied"
                : `Copy the message${course.instructor ? ` for ${course.instructor}` : ""}`}
            </button>
            <button
              className="action"
              disabled={course.draftMessage === ""}
              aria-expanded={openCourseId === course.courseId}
              onClick={() =>
                setOpenCourseId(openCourseId === course.courseId ? null : course.courseId)
              }
            >
              {openCourseId === course.courseId ? "Hide the message" : "Read it first"}
            </button>
          </div>

          {openCourseId === course.courseId && (
            <pre className="draft-message" aria-label={`Draft message for ${course.courseLabel}`}>
              {course.draftMessage}
            </pre>
          )}
        </div>
      ))}
    </section>
  );
}
