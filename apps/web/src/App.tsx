import { useCallback, useEffect, useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import { api, API_BASE, ApiError, isDesktop, setStoredToken } from "./lib/api";
import { connectionFault, connectionMessage, type ConnectionFault } from "./lib/connection";
import { loginTokenFrom } from "./lib/sign-in-link";
import type { Me, PlanDiff, PlanResponse, Term } from "./lib/types";
import { SignIn } from "./components/SignIn";
import { Onboarding } from "./components/Onboarding";
import { CourseManager } from "./components/CourseManager";
import { Today } from "./components/Today";
import { Coach } from "./components/Coach";
import { WeekMap } from "./components/WeekMap";
import { Questline } from "./components/Questline";
import { CampaignArc } from "./components/CampaignArc";
import { SessionBrief } from "./components/SessionBrief";
import { WeeklyReview } from "./components/WeeklyReview";
import { MealWindows } from "./components/MealWindows";
import { EffortSurvey } from "./components/EffortSurvey";
import { OpenQuestions } from "./components/OpenQuestions";
import { ProviderSettings } from "./components/ProviderSettings";
import { TermCalendar } from "./components/TermCalendar";
import { TermSettings } from "./components/TermSettings";
import { ArchivedTerms } from "./components/ArchivedTerms";
import { StudyHours } from "./components/StudyHours";
import { Stats } from "./components/Stats";
import { Dashboard } from "./components/Dashboard";
import { WeekCalendar } from "./components/WeekCalendar";
import { TerrainMap } from "./components/TerrainMap";
import { AssignmentsTable, CoursesTable, LookaheadTable, WeekTable } from "./components/Tables";
import { useViewMode } from "./lib/view-mode";
import { CampaignTable } from "./components/CampaignTable";
import { buildLayers, LayerBar } from "./components/LayerBar";
import type { GaugeTarget } from "@schoolquest/planning-engine";
import { SyllabusUpload } from "./components/SyllabusUpload";
import { SetupStatus } from "./components/SetupStatus";
import { StopButton } from "./components/StopButton";
import { DiagnosticsButton } from "./components/DiagnosticsButton";
import { CourseGaugeBoard } from "./components/CourseGaugeBoard";
import { CampaignRadar } from "./components/CampaignRadar";
import { PlanChanges } from "./components/PlanChanges";

/**
 * App shell.
 *
 * Every tab is available in every shell. Setup work (courses, syllabi) is a sit-down task
 * the desktop app is best at, but locking it away entirely turned out to strand two real
 * cases: a fresh account on a phone, and development in a plain browser where the Tauri
 * check is false. Emphasis, not enforcement.
 */

/**
 * `work` is its own tab rather than a view toggle.
 *
 * The assignments table is where a syllabus gets corrected -- a date moved, a task set in class,
 * a chapter dropped -- which is a weekly errand for the whole term. It was reachable only by
 * switching the view mode to Tables while on the week, which is two deductions a student has to
 * make before they can fix a date their instructor just changed. A thing done every week gets a
 * door of its own, and correcting a date is not a "table view" preference.
 */
type Tab = "radar" | "today" | "week" | "work" | "stats" | "coach" | "setup";

/** How the week is drawn. A peer of the map, not a fallback for it — the map answers what
 *  the student is working on, the calendar answers where the hours go. */
type WeekView = "map" | "calendar" | "terrain";

/**
 * Sessions loaded from a saved plan carry startAt/endAt but no precomputed minutes —
 * only freshly generated plans have that field. Screens render "· 45m" style summaries,
 * and a missing value showed up in the wild as the truncated string "Wed · m".
 */
/** Distinct work items the plan flags as at risk or needing a decision. */
function countAtRisk(plan: PlanResponse): number {
  return new Set(
    plan.risks
      .filter((r) => r.level === "at_risk" || r.level === "decision_needed")
      .map((r) => r.workItemId ?? r.code),
  ).size;
}

function normalizePlan(plan: PlanResponse): PlanResponse {
  return {
    ...plan,
    sessions: plan.sessions.map((s) => ({
      ...s,
      minutes:
        s.minutes ?? Math.max(0, Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000)),
    })),
  };
}

/**
 * Spends a sign-in token that arrived in the address bar, before anything asks who the user is.
 *
 * The API mails `${APP_URL}/auth/callback?token=…` and that URL lands on this single-page app,
 * which until now read nothing from it — so following the emailed link showed the sign-in form
 * again, and there was no way at all to complete a sign-in outside local development, where the
 * link is echoed back in the response instead. This is the step that was missing.
 *
 * The token is stripped from the URL whether or not it worked. It is single use, so leaving it
 * there means a refresh or a back button spends a token that is already gone and lands the
 * student on "that link did not work" for a link that in fact did.
 */
async function redeemLinkInUrl(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const token = loginTokenFrom(window.location.href);
  if (!token) return false;

  try {
    const { sessionToken } = await api.post<{ sessionToken: string }>("/api/auth/callback", {
      token,
    });
    setStoredToken(sessionToken);
    return true;
  } catch {
    // An expired or reused link is not an error state of its own: falling through leaves the
    // student on the sign-in screen, which is where they need to be to ask for a fresh one.
    return false;
  } finally {
    // Relative, so this never has to reason about what `location.origin` is — under the desktop
    // shell's custom scheme it can be the string "null", and handing that to replaceState throws.
    window.history.replaceState({}, "", "/");
  }
}

/**
 * A moment to read and plan the term from, other than now.
 *
 * **Development only, twice over**: the server ignores it outright once a mail provider is
 * configured, so a stray key in a real browser does nothing at all. It exists so the
 * screenshot and simulation tools can look at a term from week nine — every derived view is
 * "as of now", and without it they stayed pinned to the wall clock however far the plan
 * underneath them had been walked.
 */
function devNow(): string | null {
  try {
    return localStorage.getItem("sq_dev_now");
  } catch {
    return null;
  }
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [term, setTerm] = useState<Term | null>(null);
  /** Whether the "start a new semester" confirmation is showing. */
  const [confirmNewTerm, setConfirmNewTerm] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  /** What the most recent regenerate changed, shown until dismissed or the next one. */
  const [lastDiff, setLastDiff] = useState<PlanDiff | null>(null);
  /**
   * The radar opens the app.
   *
   * Today answers "what do I do in the next hour", which is the right question once you have
   * already decided the week is under control. Deciding that is the harder problem and the
   * one nothing else here answered: the radar is where a student sees what is coming before
   * choosing what to do about it, so it comes first and it comes up first.
   */
  const [tab, setTab] = useState<Tab>("radar");
  /**
   * Bumped by anything on Setup that saves, so the status panel re-reads.
   *
   * A counter rather than another callback threaded through nine cards: each already reports
   * upward through `onChanged`, and adding a tenth consumer to every one is how one gets
   * forgotten and the panel goes quietly stale -- exactly the calendar-gate bug.
   */
  const [setupSaves, setSetupSaves] = useState(0);
  const noteSetupChange = useCallback(() => setSetupSaves((n) => n + 1), []);

  /**
   * Setup, landing on the effort survey rather than at the top of the tab.
   *
   * The survey is the fourth card down. Switching tabs and leaving the reader to scroll past
   * three others reintroduces exactly the step the nudge on Today exists to remove — and this
   * app's reader is the one who does not scroll. `requestAnimationFrame` waits for the tab to
   * render before the element exists to scroll to.
   */
  /**
   * Switches tab and scrolls to a card, waiting for it to exist.
   *
   * Generalised from the effort-survey jump, which had this logic inline. Cards on Setup fetch
   * their own data after mounting, so for the first frames the element is not there and the
   * scroll silently does nothing -- landing the reader at the top of a nine-card page, several
   * cards above the thing they asked for, which is the step the jump exists to remove. Polls
   * briefly and gives up rather than leaving a timer running on a page that never settles.
   */
  const goTo = useCallback((tabId: Tab, elementId?: string) => {
    setTab(tabId);
    if (!elementId) {
      window.scrollTo({ top: 0 });
      return;
    }
    const deadline = Date.now() + 2000;
    const tryScroll = () => {
      const target = document.getElementById(elementId);
      if (target) target.scrollIntoView({ block: "start" });
      else if (Date.now() < deadline) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }, []);

  /** Where each gauge's "what to do next" lands. The board chooses; this routes. */
  const goToGaugeTarget = useCallback(
    (target: GaugeTarget) => {
      const routes: Record<GaugeTarget, [Tab, string?]> = {
        "setup:calendar": ["setup", "term-calendar"],
        "setup:syllabus": ["setup", "syllabus-upload"],
        "setup:courses": ["setup", "course-manager"],
        "setup:grading": ["setup", "course-manager"],
        "setup:effort": ["setup", "effort-survey"],
        today: ["today"],
        week: ["week"],
        // The grade dial sends the student to record a result, which is done on the
        // assignments table beside the work -- the same tab the radar opens work items in.
        work: ["work"],
        stats: ["stats"],
      };
      const [tabId, elementId] = routes[target];
      goTo(tabId, elementId);
    },
    [goTo],
  );

  const goToEffortSurvey = () => {
    setTab("setup");
    /**
     * Waits for the card to exist rather than for a frame.
     *
     * The survey fetches its questions after mount, so on the first two animation frames the
     * element is not there yet and the scroll silently did nothing — the reader landed at the
     * top of Setup, three cards above the thing they asked for, which is the step this was
     * built to remove. Polls briefly and gives up rather than waiting forever, because a page
     * that never settles must not leave a timer running.
     */
    const deadline = Date.now() + 2000;
    const tryScroll = () => {
      const target = document.getElementById("effort-survey");
      if (target) target.scrollIntoView({ block: "start" });
      else if (Date.now() < deadline) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  };
  // The course lens. Lives here rather than in any one card because it is a lens on the
  // shared surface — the week, the arc and the table all read from it, which is the whole
  // difference between "one map with layers" and "a map per course".
  /**
   * Classes switched off, governing every card on the week.
   *
   * Held here rather than inside any one card because it is one decision about the week, not a
   * per-card setting — five places to set the same thing is exactly the working-memory tax this
   * app exists to remove.
   *
   * **Never persisted, on purpose.** The worst thing this control can do is let a student switch
   * four classes off, get distracted, and come back next week to an app quietly under-reporting
   * the term. A filter that survives a session is how a class gets lost, so this one resets.
   */
  const [hiddenCourseIds, setHiddenCourseIds] = useState<ReadonlySet<string>>(new Set());
  const [weekView, setWeekView] = useState<WeekView>("map");
  const [viewMode, setViewMode] = useViewMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Held apart from `error` because it is the only failure that has to be shown *before* sign-in.
   *
   * `error` is rendered inside the signed-in shell, below the header — which meant that a first
   * run with no internet, or an installer built against the wrong origin, set it and then
   * returned the sign-in screen instead, throwing the explanation away. What the student saw was
   * a normal-looking sign-in form that answered "Failed to fetch" when they used it.
   */
  const [fault, setFault] = useState<ConnectionFault | null>(null);

  const theme: ThemeName = me?.theme ?? "plain";

  const loadPlan = useCallback(async (termId: string) => {
    try {
      const when = devNow();
      const current = await api.get<PlanResponse>(
        `/api/terms/${termId}/plans/current${when ? `?now=${encodeURIComponent(when)}` : ""}`,
      );
      // No plan yet (fresh account, or the horizon has rolled over): generate the first one.
      if (!current.planVersion) {
        setPlan(await api.post<PlanResponse>(`/api/terms/${termId}/plans/generate`, {}));
      } else {
        setPlan(normalizePlan(current));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your plan.");
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFault(null);
    try {
      await redeemLinkInUrl();

      const { user } = await api.get<{ user: Me }>("/api/me");
      setMe(user);

      const { terms } = await api.get<{ terms: Term[] }>("/api/terms");
      // Prefer the active term; fall back to any that is not archived; otherwise none, which
      // sends the student to onboarding -- the path "start a new semester" relies on, since it
      // archives the current term and expects a clean slate rather than the archived one back.
      const active =
        terms.find((t) => t.status === "active") ??
        terms.find((t) => t.status !== "archived") ??
        null;
      setTerm(active);
      if (active) await loadPlan(active.id);
    } catch (e) {
      // A 401 simply means "not signed in", which is a state, not an error to display.
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
      } else {
        const connection = connectionFault(e, { apiBase: API_BASE, packaged: isDesktop });
        if (connection) setFault(connection);
        else setError(e instanceof Error ? e.message : "Could not reach the server.");
      }
    } finally {
      setLoading(false);
    }
  }, [loadPlan]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    document.body.dataset["reducedMotion"] = String(me?.reducedMotion ?? false);
    // Theme drives presentation only — CSS keys off this attribute, and the Plain theme
    // stays exactly as calm as it always was. Domain data never changes with it.
    document.body.dataset["theme"] = theme;
  }, [me?.reducedMotion, theme]);

  const refreshPlan = useCallback(() => {
    if (term) void loadPlan(term.id);
  }, [term, loadPlan]);

  /**
   * Re-reads the term itself, not just the plan built from it.
   *
   * `regenerate` reloads the plan and nothing else, which is right for anything that changes
   * work items -- but the term carries its own state that screens gate on. The calendar is the
   * one that bit: pasting it stored exceptions on the term, `regenerate` reloaded the plan, and
   * `term.calendar` in memory stayed empty. So `hasCalendar` remained false and the syllabus
   * upload stayed disabled, with the screen saying to add a calendar that had just been added.
   *
   * The only way out was a browser refresh, which re-ran `bootstrap` -- a fix nobody would guess
   * at, for a bug that looks exactly like a broken button.
   */
  const refreshTerm = useCallback(async () => {
    const { terms } = await api.get<{ terms: Term[] }>("/api/terms");
    const current = terms.find((t) => t.id === term?.id);
    if (current) setTerm(current);
  }, [term?.id]);

  /**
   * Builds a new plan, then reads it back the way every other screen reads it.
   *
   * The generate response is the scheduler's own output and carries none of the derived
   * views the week is built from — no session brief, no campaign table, no term arc, no
   * weekly review. Setting it directly as the plan therefore quietly gutted the Week tab
   * every time anything triggered a rebuild: answering "yes, put it in my week" replanned
   * correctly and then left the student looking at a stripped page with the rest of their
   * questions gone. One extra read costs a request and keeps every screen whole.
   */
  const regenerate = useCallback(async (options?: { from?: string }) => {
    if (!term) return;
    // The simulated clock has to reach the *write* side too, or a replan issued while
    // looking at week nine plans week one: the horizon lands seven weeks behind everything
    // on screen, every due date falls outside it, and the plan comes back empty. That is
    // not a subtle failure and it made an end-to-end check of the radar's own action
    // measure nothing at all. Ignored by the server in production, exactly as on the read.
    const when = devNow();
    // Some callers hand this to an event handler, so only a real option object counts.
    const from = typeof options?.from === "string" ? options.from : undefined;
    const generated = await api.post<PlanResponse>(`/api/terms/${term.id}/plans/generate`, {
      reason: "manual_refresh",
      ...(when ? { now: when } : {}),
      // A day given up is planned from the next one: the hours left in it are still "free"
      // by the availability rules, and a replan from now simply books them again.
      ...(from ? { horizonStart: from } : when ? { horizonStart: when.slice(0, 10) } : {}),
    });
    // The diff rides on the generate response only; the read that follows is the plan as
    // every screen sees it. Held here so Today and the week can both say what just changed.
    setLastDiff(generated.diff ?? null);
    await loadPlan(term.id);
  }, [term, loadPlan]);

  /**
   * The radar's one action: put these items at the front of the queue and replan.
   *
   * A board that shows a shortfall and offers nothing to do about it hands the planning
   * problem straight back, which is the whole thing this app is for. Raising the student's
   * own priority is the honest lever — it is the field the scheduler already reads as "the
   * student says this matters", and it survives every later replan rather than being a
   * one-off nudge that quietly evaporates on Sunday.
   */
  const prioritize = useCallback(
    async (workItemIds: string[]) => {
      if (!term) return;
      // Surfaced through the shell's own error line: these are fired from buttons whose
      // component resets its busy state in a `finally`, so a rejection that escapes here
      // would reach nothing but the console and the button would simply appear not to work.
      try {
        for (const id of workItemIds) {
          await api.patch(`/api/work-items/${id}`, { userPriority: 2 });
        }
        await regenerate();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not save.");
      }
    },
    [term, regenerate],
  );

  /**
   * "I handed this in", said from wherever the student happens to be looking.
   *
   * A separate call per item rather than one bulk route: a merged encounter is a display
   * grouping, not an entity, and the two assignments behind it are handed in independently
   * even when they were drawn as one diamond.
   */
  const handIn = useCallback(
    async (workItemIds: string[]) => {
      if (!term) return;
      try {
        for (const id of workItemIds) {
          await api.patch(`/api/work-items/${id}`, { status: "submitted" });
        }
        await regenerate();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not save.");
      }
    },
    [term, regenerate],
  );

  const openWorkItem = useCallback(
    (workItemId: string) => goTo("work", `work-item-${workItemId}`),
    [goTo],
  );

  async function changeTheme(next: ThemeName) {
    const { user } = await api.patch<{ user: Me }>("/api/me", { theme: next });
    setMe(user);
  }

  async function signOut() {
    await api.post("/api/auth/logout").catch(() => undefined);
    setStoredToken(null);
    setMe(null);
    setPlan(null);
    setTerm(null);
  }

  /**
   * Start over with a fresh semester. The current term is archived rather than deleted -- its
   * record survives, it just stops being the active one -- and with no active term the app drops
   * back into onboarding to set up the new one. Courses, syllabi and assignments belong to the
   * old term and stay with it; the new term begins empty.
   */
  async function startNewSemester() {
    if (!term) return;
    setConfirmNewTerm(false);
    await api.post(`/api/terms/${term.id}/archive`).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not start a new semester.");
    });
    setPlan(null);
    setTerm(null);
    await bootstrap();
  }

  // The roster row highlight and the class switches are one state, not two: a class is
  // "selected" in the roster exactly when it is the only one still switched on.
  const visibleCourseIds = (plan?.courses ?? [])
    .map((c) => c.id)
    .filter((id) => !hiddenCourseIds.has(id));
  const soloCourseId = visibleCourseIds.length === 1 ? visibleCourseIds[0]! : null;

  if (loading) {
    return (
      <div className="centered">
        <p className="muted">Loading your plan…</p>
      </div>
    );
  }

  // Ahead of the sign-in screen, because a sign-in form that cannot reach a server is a trap:
  // it looks like the app working, and the student only finds out otherwise after typing their
  // address and waiting. This is the whole first-run experience when campus wifi has not come up
  // yet, so it says which of the two things is wrong and, where it helps, what to do next.
  if (fault) {
    const { title, detail, canRetry } = connectionMessage(fault, {
      apiBase: API_BASE,
      packaged: isDesktop,
    });
    return (
      <div className="centered">
        <h1>{title}</h1>
        <p className="muted">{detail}</p>
        {canRetry && (
          <button className="action primary" onClick={() => void bootstrap()}>
            Try again
          </button>
        )}
        {/* The one screen where nothing else works: give the student the log to send for help. */}
        <div style={{ marginTop: "1.25rem" }}>
          <DiagnosticsButton compact />
        </div>
      </div>
    );
  }

  if (!me) return <SignIn onSignedIn={bootstrap} />;

  // A fresh account walks through setup instead of hitting a dead end. This runs in any
  // shell: setup is *emphasized* on desktop, not locked to it — a phone-only user still
  // deserves a way in.
  if (!term)
    return (
      <Onboarding
        onDone={bootstrap}
        onSignOut={signOut}
        theme={theme}
        onThemeChange={(t) => setMe((m) => (m ? { ...m, theme: t } : m))}
      />
    );

  const tabs: { id: Tab; labelText: string }[] = [
    { id: "radar", labelText: label("radar", theme) },
    { id: "today", labelText: "Today" },
    { id: "week", labelText: label("weekMap", theme) },
    { id: "work", labelText: `${label("assignment", theme)}s` },
    { id: "stats", labelText: label("statsPage", theme) },
    { id: "coach", labelText: label("coach", theme) },
    { id: "setup", labelText: "Setup" },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>SchoolQuest</h1>
        <div className="view-switch" role="group" aria-label="How to show your data">
          <button
            aria-pressed={viewMode === "visual"}
            onClick={() => setViewMode("visual")}
          >
            Visual
          </button>
          <button aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}>
            Tables
          </button>
        </div>
        <nav className="tabs" aria-label="Main">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.labelText}
            </button>
          ))}
        </nav>
      </header>

      {error && <p className="error">{error}</p>}

      {!plan ? (
        <p className="muted">Building your first plan…</p>
      ) : (
        <>
          {tab === "radar" &&
            (plan.radar ? (
              <CampaignRadar
                radar={plan.radar}
                courses={plan.courses}
                theme={theme}
                termName={term.name}
                onOpenWork={openWorkItem}
                onPrioritize={prioritize}
                onHandIn={handIn}
              />
            ) : (
              // The radar is built on saved-plan reads. A plan generated a moment ago in this
              // session has not been read back yet, so say that rather than drawing an empty
              // board that reads as "you have nothing due".
              <p className="muted">
                The radar comes up with your saved plan. Refresh, or generate a plan from Today.
              </p>
            ))}
          {tab === "today" && lastDiff && (
            <PlanChanges
              diff={lastDiff}
              plan={plan}
              theme={theme}
              risksNow={countAtRisk(plan)}
              onDismiss={() => setLastDiff(null)}
            />
          )}
          {tab === "today" && (
            <Today
              plan={plan}
              termId={term.id}
              theme={theme}
              onChanged={refreshPlan}
              onReplan={regenerate}
              onGoToSetup={goToEffortSurvey}
              onOpenWork={openWorkItem}
            />
          )}
          {/* The week tab reads as one zoom-out: the seven days as beats, then the term's
              landmarks, then how far each course has come. */}
          {tab === "week" && (
            <>
              {lastDiff && (
                <PlanChanges
                  diff={lastDiff}
                  plan={plan}
                  theme={theme}
                  risksNow={countAtRisk(plan)}
                  onDismiss={() => setLastDiff(null)}
                />
              )}
              {/* Before the week ahead, what the weeks behind have to say about it. First
                  because its answers change the plan below it, and a question the student
                  has to scroll to find is a question nobody answers. It renders nothing at
                  all when the weeks went as planned. */}
              {plan.review && (
                <WeeklyReview
                  review={plan.review}
                  termId={term.id}
                  theme={theme}
                  onAnswered={regenerate}
                />
              )}
              {viewMode === "table" ? (
                <>
                  <WeekTable plan={plan} theme={theme} />
                  <LookaheadTable plan={plan} theme={theme} />
                  <AssignmentsTable plan={plan} theme={theme} onChanged={regenerate} />
                </>
              ) : (
                <>
                  {plan.brief && (
                    <SessionBrief brief={plan.brief} courses={plan.courses} theme={theme} />
                  )}
                  {plan.courseLoad && (
                    <CampaignTable
                      load={plan.courseLoad}
                      courses={plan.courses}
                      theme={theme}
                      // The roster highlights a class when it is the only one left switched on,
                      // so clicking a row and using the switches say the same thing rather than
                      // being two controls arguing over one picture.
                      selectedCourseId={soloCourseId}
                      onSelectCourse={(id) =>
                        setHiddenCourseIds(
                          id === null
                            ? new Set()
                            : new Set(plan.courses.map((c) => c.id).filter((c) => c !== id)),
                        )
                      }
                    />
                  )}

                  <LayerBar
                    layers={buildLayers(plan, hiddenCourseIds)}
                    theme={theme}
                    onToggle={(courseId) =>
                      setHiddenCourseIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(courseId)) next.delete(courseId);
                        else next.add(courseId);
                        return next;
                      })
                    }
                    onAll={() => setHiddenCourseIds(new Set())}
                  />

                  {/* The week has two honest shapes and neither replaces the other: the map
                      says what the work is, the calendar says where the hours go. */}
                  <div className="button-row" style={{ margin: "0 0 0.5rem" }}>
                    <button
                      className={`action${weekView === "map" ? " primary" : ""}`}
                      aria-pressed={weekView === "map"}
                      onClick={() => setWeekView("map")}
                    >
                      {label("weekMap", theme)}
                    </button>
                    <button
                      className={`action${weekView === "calendar" ? " primary" : ""}`}
                      aria-pressed={weekView === "calendar"}
                      onClick={() => setWeekView("calendar")}
                    >
                      Hour by hour
                    </button>
                    <button
                      className={`action${weekView === "terrain" ? " primary" : ""}`}
                      aria-pressed={weekView === "terrain"}
                      onClick={() => setWeekView("terrain")}
                    >
                      The road ahead
                    </button>
                  </div>

                  {weekView === "terrain" ? (
                    <TerrainMap
                      plan={plan}
                      theme={theme}
                      reducedMotion={me?.reducedMotion ?? false}
                      hiddenCourseIds={hiddenCourseIds}
                    />
                  ) : weekView === "calendar" ? (
                    <WeekCalendar
                      plan={plan}
                      theme={theme}
                      hiddenCourseIds={hiddenCourseIds}
                      onChanged={refreshPlan}
                    />
                  ) : (
                    <WeekMap
                      plan={plan}
                      theme={theme}
                      brief={plan.brief}
                      hiddenCourseIds={hiddenCourseIds}
                    />
                  )}

                  {plan.brief && (
                    <CampaignArc
                      milestones={plan.brief.milestones}
                      undatedMilestones={plan.brief.undatedMilestones}
                      courses={plan.courses}
                      theme={theme}
                      hiddenCourseIds={hiddenCourseIds}
                    />
                  )}
                  {plan.progress && (
                    <Questline progress={plan.progress} courses={plan.courses} theme={theme} />
                  )}
                </>
              )}
            </>
          )}
          {tab === "work" && (
            <AssignmentsTable plan={plan} theme={theme} onChanged={regenerate} />
          )}

          {/* Where the big things stand. Its own screen rather than another card on the
              week: "am I going to make it" is a question about months, and answering it
              underneath a seven-day grid buries it. */}
          {/* The term page opens with the one question no other screen answers — which
              course needs me — and only then goes into the detail behind it. */}
          {tab === "stats" && viewMode === "table" && <CoursesTable plan={plan} theme={theme} />}
          {tab === "stats" && viewMode === "visual" && plan.health && (
            <CourseGaugeBoard
              termId={term.id}
              health={plan.health}
              courses={plan.courses}
              onNavigate={goToGaugeTarget}
              refreshKey={setupSaves}
            />
          )}
          {tab === "stats" && viewMode === "visual" && plan.health && (
            <Dashboard
              health={plan.health}
              courses={plan.courses}
              workItems={plan.workItems}
              theme={theme}
              onChanged={refreshPlan}
            />
          )}
          {tab === "stats" && viewMode === "visual" && plan.projects && (
            <Stats
              projects={plan.projects}
              progress={plan.progress}
              courses={plan.courses}
              standings={plan.standings}
              theme={theme}
            />
          )}
          {tab === "coach" && (
            <Coach termId={term.id} theme={theme} onPlanChanged={refreshPlan} />
          )}
          {tab === "setup" && (
            <>
              {/*
                First on the screen, and the order is the argument. Every relative date a
                syllabus contains — "Week 14", "each Tuesday in class", "finals week" — is read
                against this, so a syllabus uploaded before it is read against guesses.
              */}
              {/*
                Above the calendar, because it is the one thing that has to be true before any of
                the rest works: with no key, pasting a calendar and uploading a syllabus both fail
                at the point the student has already done the work.
              */}
              {/*
                First on the page. The one question a student has while working through Setup --
                have I done this for every class yet -- was answered by none of the nine cards
                below, so the only way to know was to scroll, remember, and count.
              */}
              <SetupStatus termId={term.id} refreshKey={setupSaves} />
              <ProviderSettings onChanged={refreshPlan} />
              <TermSettings
                term={term}
                onChanged={async () => {
                  await refreshTerm();
                  await regenerate();
                  noteSetupChange();
                }}
              />
              {/*
                The term is re-read, not only the plan: what the calendar changes lives on the
                term, and the syllabus upload below gates on it.
              */}
              <div id="term-calendar">
              <TermCalendar
                termId={term.id}
                onChanged={async () => {
                  await refreshTerm();
                  await regenerate();
                  noteSetupChange();
                }}
              />
              </div>
              <div id="course-manager">
              <CourseManager
                termId={term.id}
                onChanged={() => {
                  refreshPlan();
                  noteSetupChange();
                }}
              />
              </div>
              {/*
                Above the effort survey on purpose. The survey asks the student what they know;
                this says what nobody knows yet and hands them the message that gets it answered,
                which is the step that has to happen before an answer can exist.
              */}
              <OpenQuestions termId={term.id} onAnswer={(tab, elementId) => goTo(tab as Tab, elementId)} />
              <EffortSurvey termId={term.id} onChanged={regenerate} />
              <StudyHours termId={term.id} onChanged={regenerate} />
              <MealWindows term={term} onChanged={regenerate} />
              <div id="syllabus-upload">
              <SyllabusUpload
                courses={plan.courses}
                onPlanChanged={async () => {
                  await regenerate();
                  noteSetupChange();
                }}
                hasCalendar={(term.calendar?.exceptions.length ?? 0) > 0}
              />
              </div>
              {/*
                At the end of Setup rather than in the header. "How do I close this?" is a
                question someone asks deliberately, not one they want a button for beside the
                thing they are working on -- and a control that stops the whole app should not
                sit a few pixels from the tabs.
              */}
              <section className="card">
                <h2>Stopping SchoolQuest</h2>
                <p className="muted">
                  Closing this tab leaves SchoolQuest running in the background, which is what
                  makes it complain about a busy port next time. This stops it properly.
                </p>
                <div className="button-row">
                  <StopButton />
                </div>
              </section>

              <section className="card">
                <h2>Preferences</h2>
                <div className="button-row">
                  {(["plain", "quest", "mission"] as const).map((t) => (
                    <button
                      key={t}
                      className={`action${theme === t ? " primary" : ""}`}
                      onClick={() => changeTheme(t)}
                    >
                      {t[0]!.toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ marginTop: "0.6rem" }}>
                  Themes change wording only. Your courses, assignments, and plan are
                  untouched.
                </p>
              </section>
              <section className="card">
                <h2>Account</h2>
                <div className="button-row">
                  <button className="action" onClick={() => void regenerate()}>
                    Rebuild this week&apos;s plan
                  </button>
                  <button className="action" onClick={() => setConfirmNewTerm((v) => !v)}>
                    Start a new semester
                  </button>
                  <button className="action" onClick={signOut}>
                    Sign out
                  </button>
                </div>
                {confirmNewTerm && (
                  <div
                    className="replace-confirm"
                    role="alertdialog"
                    aria-label="Confirm starting a new semester"
                    style={{ marginTop: "0.7rem", marginBottom: 0 }}
                  >
                    <p style={{ margin: "0 0 0.5rem" }}>
                      Start a new semester and set it up from scratch?
                    </p>
                    <p className="muted" style={{ margin: "0 0 0.7rem", fontSize: "0.9rem" }}>
                      This archives <strong>{term.name}</strong> -- its courses, syllabi and
                      assignments stay with it as a record -- and takes you back to the start to
                      build the new one. You will pick a term, add courses, and upload syllabi again.
                    </p>
                    <div className="button-row">
                      <button className="action primary" onClick={() => void startNewSemester()}>
                        Archive {term.name} and start fresh
                      </button>
                      <button className="action" onClick={() => setConfirmNewTerm(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
              {/* When something goes wrong, the app remembers what it did; this is how that log
                  gets back to whoever can read it. A server-side log is unreachable when the
                  install points at its own backend, so the student carries it out by hand. */}
              <section className="card">
                <h2>Help &amp; diagnostics</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Something not working? <strong>Report a problem</strong> opens an email with a
                  diagnostics log attached for you to paste. It names this build and what the app
                  recently did, and never contains your assignments, password, or personal data.
                </p>
                <DiagnosticsButton />
              </section>
              {/* Renders itself only when something is archived; reopening reloads the app on
                  the chosen term. This is the "get it back" path for a semester set aside. */}
              <ArchivedTerms onReopened={bootstrap} />
            </>
          )}
        </>
      )}
    </div>
  );
}
