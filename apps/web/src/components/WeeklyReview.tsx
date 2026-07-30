import { useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import type { CommitmentProposalView, ReviewQuestionView, WeeklyReviewView } from "../lib/types";

/**
 * What the weeks that already happened have to say about the week being planned.
 *
 * This card exists because of a specific failure the planner could not otherwise escape. A
 * student with a standing Thursday commitment nobody wrote down gets Thursday evening booked
 * every week, and loses it every week. The plan is not unlucky; it is built on a wrong map.
 * Left alone it fails identically forever, and every repetition reads to the student as
 * evidence about themselves rather than about the calendar.
 *
 * Everything about the wording here follows from that. Three rules, and they are not
 * stylistic:
 *
 * 1. **No counting, no scoring, no history of failure.** The product bans streaks, decay and
 *    loss mechanics (docs/01-product-brief.md §3), and this is the one screen where they
 *    would be easiest to reach for and most damaging. There is no "3 sessions missed" tally
 *    anywhere in this file. Occurrences are named as *dates the plan was wrong about*, which
 *    is the same information pointed at the calendar instead of at the person.
 * 2. **The subject is always the plan.** "This time keeps getting booked and keeps not
 *    working" — never "you keep missing this". The student is the authority being consulted
 *    about what is really there, not the party being asked to explain themselves.
 * 3. **Every answer is an ordinary answer.** "Just those weeks" is not a lesser choice than
 *    adding a commitment, and declining to say is not a lesser choice than either. All three
 *    close the question; only one changes the calendar.
 *
 * The card renders nothing at all when the weeks went to plan. A review that appears every
 * week regardless is a review nobody reads.
 */

const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Matches the plain-English options in CourseManager's commitment form. */
const COMMITMENT_TYPES: { value: string; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "class", label: "Class" },
  { value: "club", label: "Club or team" },
  { value: "worship", label: "Worship or service" },
  { value: "exercise", label: "Exercise" },
  { value: "appointment", label: "Appointment" },
  { value: "commute", label: "Travel" },
  { value: "meal", label: "Meal" },
  { value: "other", label: "Something else" },
];

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? h : `${h} ${rest} minutes`;
}

/** "2026-09-24" -> "Sep 24". Date-only strings are UTC days; local parsing shifts them. */
function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "17:00" -> "5:00 PM", in the reader's own conventions. */
function clock(time: string): string {
  const [h, m] = time.split(":");
  const date = new Date(Date.UTC(2000, 0, 1, Number(h), Number(m)));
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function WeeklyReview({
  review,
  termId,
  theme,
  onAnswered,
}: {
  review: WeeklyReviewView;
  termId: string;
  theme: ThemeName;
  onAnswered: () => void;
}) {
  const quest = theme === "quest";
  // Answered questions disappear immediately rather than waiting on the refreshed plan, so
  // the card cannot show a question the student has just settled.
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = review.questions.filter((q) => !settled.has(q.slotKey));
  if (open.length === 0) return null;

  async function answer(
    question: ReviewQuestionView,
    choice: "one_off" | "dismissed" | "promote",
    commitment?: CommitmentProposalView,
  ) {
    setBusy(question.slotKey);
    setError(null);
    try {
      await api.post(`/api/terms/${termId}/review/answer`, {
        slotKey: question.slotKey,
        occurrences: question.occurrences.length,
        answer: choice,
        ...(choice === "promote" && commitment
          ? {
              commitment: {
                title: commitment.title,
                commitmentType: commitment.commitmentType,
                daysOfWeek: commitment.daysOfWeek,
                startTime: commitment.startTime,
                endTime: commitment.endTime,
              },
            }
          : {}),
      });
      setSettled((prev) => new Set(prev).add(question.slotKey));
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save. Try again?");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="weekly-review-heading">
      <h2 id="weekly-review-heading">
        <span aria-hidden="true">{label("weekReview", theme)}</span>
        <span className="sr-only">How last week went</span>
      </h2>

      <p className="muted" style={{ margin: "0 0 0.85rem" }}>
        {quest
          ? "Some of what was on the map last session never got played. That usually means the map is wrong, not the party — so before the next one is drawn, what is actually there?"
          : "Some of the time booked in recent weeks did not get used. Usually that means the plan has the wrong idea about your week, so it is worth checking what is really there."}
      </p>

      {open.map((question) => (
        <ReviewCase
          key={question.slotKey}
          question={question}
          quest={quest}
          busy={busy === question.slotKey}
          onAnswer={(choice, commitment) => void answer(question, choice, commitment)}
        />
      ))}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ReviewCase({
  question,
  quest,
  busy,
  onAnswer,
}: {
  question: ReviewQuestionView;
  quest: boolean;
  busy: boolean;
  onAnswer: (choice: "one_off" | "dismissed" | "promote", commitment?: CommitmentProposalView) => void;
}) {
  const proposal = question.proposal;
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState<CommitmentProposalView>(
    proposal ?? {
      title: "",
      commitmentType: "other",
      daysOfWeek: [question.dayOfWeek],
      startTime: question.startTime,
      endTime: question.endTime,
      named: false,
    },
  );

  const weekday = DAY_LONG[question.dayOfWeek] ?? "That day";
  const span = `${clock(question.startTime)} – ${clock(question.endTime)}`;
  const dates = question.occurrences.map((o) => shortDate(o.date));
  // The commonest thing the student named, when they named anything. Their own words are
  // always better than ours, and this is the only place the card can speak with authority
  // about *what* is there rather than only that something is.
  const named = question.occurrences.map((o) => o.cause).find(Boolean) ?? null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        paddingTop: "0.75rem",
        marginTop: "0.75rem",
      }}
    >
      <p style={{ margin: "0 0 0.3rem", fontWeight: 600 }}>
        {weekday}, {span}
      </p>

      {/* The finding, stated about the plan. The phrasing carries no count of misses: it
          names the dates the plan was wrong about, which is the same evidence aimed at the
          calendar rather than at the reader. */}
      <p className="muted" style={{ margin: "0 0 0.45rem" }}>
        {question.weeks > 1
          ? `This time has been booked on ${question.weeks} different weeks and has not been used — ${dates.join(", ")}.`
          : `This time was booked on ${dates.join(", ")} and did not get used.`}
        {" "}
        {formatMinutes(question.minutesLost)} of the plan sat here.
      </p>

      {named && (
        <p className="muted" style={{ margin: "0 0 0.45rem" }}>
          You said this was <strong>{named}</strong>.
        </p>
      )}

      <p style={{ margin: "0 0 0.6rem" }}>
        {question.weeks > 1
          ? quest
            ? "Is there something standing on that square every week?"
            : "Is something else there every week?"
          : "Was that a one-off, or does something else have that time?"}
      </p>

      {!naming ? (
        <div className="button-row">
          <button
            className="action primary"
            disabled={busy}
            onClick={() => {
              // A named proposal can be accepted as-is; an unnamed one needs a word for it
              // first, because "Time that is not free" is a placeholder, not a calendar entry.
              if (proposal?.named) onAnswer("promote", proposal);
              else setNaming(true);
            }}
          >
            Yes — put it in my week
          </button>
          <button className="action" disabled={busy} onClick={() => onAnswer("one_off")}>
            {question.weeks > 1 ? "No, just those weeks" : "No, just that week"}
          </button>
          <button className="action" disabled={busy} onClick={() => onAnswer("dismissed")}>
            Rather not say
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.title.trim().length === 0) return;
            onAnswer("promote", { ...draft, title: draft.title.trim() });
          }}
        >
          <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.82rem" }}>
            The times came from where the plan kept running aground, so adjust them if they
            are not quite right.
          </p>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              alignItems: "flex-end",
              marginBottom: "0.6rem",
            }}
          >
            <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 12rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                What is it?
              </span>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Shift, practice, church…"
                required
                autoFocus
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Kind
              </span>
              <select
                value={draft.commitmentType}
                onChange={(e) => setDraft({ ...draft, commitmentType: e.target.value })}
              >
                {COMMITMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                From
              </span>
              <input
                type="time"
                value={draft.startTime}
                onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                required
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Until
              </span>
              <input
                type="time"
                value={draft.endTime}
                onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                required
              />
            </label>
          </div>
          <div className="button-row">
            <button className="action primary" type="submit" disabled={busy}>
              Add it to every {weekday}
            </button>
            <button className="action" type="button" disabled={busy} onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
