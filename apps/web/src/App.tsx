import { useCallback, useEffect, useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import { api, setStoredToken } from "./lib/api";
import type { Me, PlanResponse, Term } from "./lib/types";
import { SignIn } from "./components/SignIn";
import { Onboarding } from "./components/Onboarding";
import { CourseManager } from "./components/CourseManager";
import { Today } from "./components/Today";
import { Coach } from "./components/Coach";
import { WeekMap } from "./components/WeekMap";
import { Questline } from "./components/Questline";
import { CampaignArc } from "./components/CampaignArc";
import { SessionBrief } from "./components/SessionBrief";
import { Stats } from "./components/Stats";
import { SyllabusUpload } from "./components/SyllabusUpload";

/**
 * App shell.
 *
 * Every tab is available in every shell. Setup work (courses, syllabi) is a sit-down task
 * the desktop app is best at, but locking it away entirely turned out to strand two real
 * cases: a fresh account on a phone, and development in a plain browser where the Tauri
 * check is false. Emphasis, not enforcement.
 */

type Tab = "today" | "week" | "stats" | "coach" | "setup";

/**
 * Sessions loaded from a saved plan carry startAt/endAt but no precomputed minutes —
 * only freshly generated plans have that field. Screens render "· 45m" style summaries,
 * and a missing value showed up in the wild as the truncated string "Wed · m".
 */
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

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [term, setTerm] = useState<Term | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const theme: ThemeName = me?.theme ?? "plain";

  const loadPlan = useCallback(async (termId: string) => {
    try {
      const current = await api.get<PlanResponse>(`/api/terms/${termId}/plans/current`);
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
    try {
      const { user } = await api.get<{ user: Me }>("/api/me");
      setMe(user);

      const { terms } = await api.get<{ terms: Term[] }>("/api/terms");
      const active = terms.find((t) => t.status === "active") ?? terms[0] ?? null;
      setTerm(active);
      if (active) await loadPlan(active.id);
    } catch (e) {
      // A 401 simply means "not signed in", which is a state, not an error to display.
      if (e instanceof Error && "status" in e && (e as { status: number }).status === 401) {
        setMe(null);
      } else {
        setError(e instanceof Error ? e.message : "Could not reach the server.");
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

  async function regenerate() {
    if (!term) return;
    setPlan(await api.post<PlanResponse>(`/api/terms/${term.id}/plans/generate`, {
      reason: "manual_refresh",
    }));
  }

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

  if (loading) {
    return (
      <div className="centered">
        <p className="muted">Loading your plan…</p>
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
    { id: "today", labelText: "Today" },
    { id: "week", labelText: label("weekMap", theme) },
    { id: "stats", labelText: label("statsPage", theme) },
    { id: "coach", labelText: label("coach", theme) },
    { id: "setup", labelText: "Setup" },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>SchoolQuest</h1>
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
          {tab === "today" && <Today plan={plan} theme={theme} onChanged={refreshPlan} />}
          {/* The week tab reads as one zoom-out: the seven days as beats, then the term's
              landmarks, then how far each course has come. */}
          {tab === "week" && (
            <>
              {plan.brief && (
                <SessionBrief brief={plan.brief} courses={plan.courses} theme={theme} />
              )}
              <WeekMap plan={plan} theme={theme} brief={plan.brief} />
              {plan.brief && (
                <CampaignArc
                  milestones={plan.brief.milestones}
                  undatedMilestones={plan.brief.undatedMilestones}
                  courses={plan.courses}
                  theme={theme}
                />
              )}
              {plan.progress && (
                <Questline progress={plan.progress} courses={plan.courses} theme={theme} />
              )}
            </>
          )}
          {/* Where the big things stand. Its own screen rather than another card on the
              week: "am I going to make it" is a question about months, and answering it
              underneath a seven-day grid buries it. */}
          {tab === "stats" && plan.projects && (
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
              <CourseManager termId={term.id} onChanged={refreshPlan} />
              <SyllabusUpload courses={plan.courses} onPlanChanged={regenerate} />
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
                  <button className="action" onClick={regenerate}>
                    Rebuild this week&apos;s plan
                  </button>
                  <button className="action" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
