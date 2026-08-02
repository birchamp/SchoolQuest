import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * Asking the student how long their work actually takes.
 *
 * The gap this closes is the largest single unknown in the app. Measured on the five-course
 * test semester: **6% of the term's remaining minutes rest on a real number.** Everything else
 * is a per-type constant, so "you have four hours of work today", every at-risk warning and
 * every "this will not fit" is a guess the student is never told is a guess.
 *
 * The engine (`buildEffortSurvey`) decides *what* to ask and collapses 60 items into 14
 * questions ordered by minutes at stake. This screen is about making those 14 answerable by
 * someone who finds forms hard:
 *
 * **One question at a time.** Fourteen at once is a form, and a form is the wall. One is a
 * decision, and a decision is something you can make while tired.
 *
 * **The end is always visible.** Every question shows what share of the guessing it settles and
 * how many are left. The first three cover 46% of the term, and saying so is what makes
 * stopping after three feel like progress rather than failure.
 *
 * **Leaving is free.** Skip moves on, the card can be closed, and nothing is lost — the survey
 * is rebuilt from current data every time it loads, so a question answered by hand elsewhere
 * simply stops appearing.
 *
 * **"I don't know" is an answer.** A first-year genuinely cannot estimate their first lab
 * report, and the syllabus does not say. That is a question for the instructor, and the message
 * is written ready to send.
 */

interface EffortOption {
  minutes: number;
  label: string;
  isCurrentAssumption: boolean;
}

interface Question {
  id: string;
  courseId: string;
  courseLabel: string;
  workType: string;
  itemCount: number;
  assumedMinutesEach: number;
  assumedMinutesTotal: number;
  shareOfAssumed: number;
  gradeSharePercent: number | null;
  question: string;
  stakes: string;
  askProfessor: string;
  options: EffortOption[];
  askedInstructorAt: string | null;
}

interface Survey {
  questions: Question[];
  assumedMinutes: number;
  knownMinutes: number;
  groundedFraction: number;
  assumedItemCount: number;
  itemCount: number;
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


export function EffortSurvey({ termId, onChanged }: { termId: string; onChanged: () => void }) {
  const theme = useBodyTheme();
  const quest = theme === "quest";

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAsk, setShowAsk] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Set once an answer lands, so the card can say what changed without a full reload. */
  const [settled, setSettled] = useState<{ items: number; grounded: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setSurvey(await api.get<Survey>(`/api/terms/${termId}/effort-survey`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this.");
    }
  }, [termId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(question: Question, minutes: number | null) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        applied: { questionId: string; itemsUpdated: number; minutes: number | null }[];
        groundedFraction: number;
        questionsLeft: number;
      }>(`/api/terms/${termId}/effort-answers`, {
        answers: [{ questionId: question.id, minutes }],
      });

      if (minutes !== null) {
        setSettled({
          items: result.applied[0]?.itemsUpdated ?? 0,
          grounded: result.groundedFraction,
        });
        // The plan is now built on a different number, so the rest of the app is stale.
        onChanged();
      }
      setShowAsk(false);
      setCopied(false);
      await load();
      // Reloading drops the answered question out of the list, so staying put lands on the
      // next one. An "I don't know" leaves it in place, so step past it instead.
      setIndex((prev) => (minutes === null ? prev + 1 : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!survey) {
    return (
      <section className="card">
        <h2>How long things take</h2>
        <p className="muted">{error ?? "Loading…"}</p>
      </section>
    );
  }

  const grounded = Math.round((settled?.grounded ?? survey.groundedFraction) * 100);

  if (survey.questions.length === 0) {
    return (
      <section className="card" aria-labelledby="effort-heading">
        <h2 id="effort-heading">
          <Themed
            visible={quest ? "The measure of the work" : "How long things take"}
            plain="How long things take"
          />
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Every piece of work ahead has a real time on it. Nothing in your plan is a guess about
          effort.
        </p>
      </section>
    );
  }

  const position = Math.min(index, survey.questions.length - 1);
  const question = survey.questions[position]!;
  const thisOne = Math.round(question.shareOfAssumed * 100);
  const left = survey.questions.length - position - 1;

  return (
    <section className="card" aria-labelledby="effort-heading">
      <h2 id="effort-heading">
        <Themed
          visible={quest ? "The measure of the work" : "How long things take"}
          plain="How long things take"
        />
      </h2>

      <p className="muted" style={{ margin: "0 0 0.4rem" }}>
        A syllabus says what is due and never says how long it takes, so right now{" "}
        <strong>{grounded}%</strong> of your planned effort rests on a real number and the rest is
        my guess. One answer here settles a whole set at once.
      </p>

      {/* A visible end to the asking. The bar is what makes stopping early feel like progress. */}
      <div
        className="meter"
        role="img"
        aria-label={`${grounded}% of your planned effort is based on real numbers`}
        style={{
          height: "0.5rem",
          borderRadius: "999px",
          background: "var(--surface-2)",
          overflow: "hidden",
          margin: "0 0 0.75rem",
        }}
      >
        <div
          style={{
            width: `${grounded}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 240ms ease",
          }}
        />
      </div>

      {settled && (
        <p className="notice" style={{ marginTop: 0 }}>
          Set {settled.items} {settled.items === 1 ? "item" : "items"}. Your plan has been rebuilt
          around it.
        </p>
      )}

      {/*
        What this *one* answer is worth, not what all the remaining ones are worth together —
        which on the first question is always 100% and tells the reader nothing. The point of
        the number is "answer this and 15% of the guessing is gone", so that is the number.
      */}
      <p className="muted" style={{ margin: "0 0 0.2rem", fontSize: "0.82rem" }}>
        This one alone settles <strong>{thisOne}%</strong> of the guessing.{" "}
        {left === 0 ? "It is the last question." : `${left} more after it.`}
      </p>

      <p style={{ margin: "0 0 0.2rem", fontWeight: 600, fontSize: "1.02rem" }}>
        {question.question}
      </p>
      <p className="muted" style={{ margin: "0 0 0.7rem" }}>
        {question.stakes}
      </p>

      <div className="button-row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
        {question.options.map((option) => (
          <button
            key={option.minutes}
            className="action"
            disabled={busy}
            onClick={() => void answer(question, option.minutes)}
            style={
              option.isCurrentAssumption
                ? { borderColor: "var(--accent)", borderWidth: "2px" }
                : undefined
            }
          >
            {option.label}
            {/*
              The word, not just the ring. A coloured border alone fails WCAG 1.4.1 for anyone
              who cannot distinguish it, and under Quest it is nearly invisible regardless —
              gold on gold. The text says which one the app is currently using, in every theme
              and for every reader.
            */}
            {option.isCurrentAssumption && (
              <>
                <span aria-hidden="true"> · assuming this</span>
                <span className="sr-only"> — what I am assuming now</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div className="button-row" style={{ marginTop: "0.6rem", flexWrap: "wrap" }}>
        <button className="action" disabled={busy} onClick={() => setShowAsk((v) => !v)}>
          I don&apos;t know — ask my {question.courseLabel} instructor
        </button>
        <button
          className="action"
          disabled={busy || position + 1 >= survey.questions.length}
          onClick={() => {
            setShowAsk(false);
            setIndex(position + 1);
          }}
        >
          Skip this one
        </button>
      </div>

      {question.askedInstructorAt && !showAsk && (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.82rem" }}>
          You noted asking about this on {question.askedInstructorAt.slice(0, 10)}. Still assumed
          until you have an answer.
        </p>
      )}

      {/*
        The panel below carries no `--surface-2` fill. Under Quest that token is dark leather
        while `--text` is the ink meant for parchment, and the pair measures 1.06:1 — the
        message would be a block of invisible brown. This is the fourth component in the
        codebase to hit it, so the rule here is to keep text on the surface it was designed
        for and mark the panel with a rule instead of a fill.
      */}
      {showAsk && (
        <div
          style={{
            marginTop: "0.7rem",
            padding: "0.6rem 0 0.2rem 0.8rem",
            borderLeft: "3px solid var(--accent)",
          }}
        >
          <p className="muted" style={{ margin: "0 0 0.4rem", fontSize: "0.82rem" }}>
            Nobody expects you to know this one. Here is a message you can send as it stands.
          </p>
          <p style={{ margin: "0 0 0.6rem", lineHeight: 1.45 }}>{question.askProfessor}</p>
          <div className="button-row" style={{ flexWrap: "wrap" }}>
            <button
              className="action"
              onClick={() => {
                void navigator.clipboard?.writeText(question.askProfessor);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy it"}
            </button>
            <button
              className="action primary"
              disabled={busy}
              onClick={() => void answer(question, null)}
            >
              I&apos;ve asked — remind me it&apos;s outstanding
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="risk" data-level="at_risk" style={{ marginTop: "0.6rem" }}>
          <span className="level">problem</span>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
