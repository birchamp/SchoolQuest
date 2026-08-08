/**
 * A real semester, start to finish: four genuine Spring 2023 syllabi, ingested and then
 * walked week by week to finals.
 *
 * Every step here is the endpoint the UI calls, in the order a student would reach it —
 * onboarding, term calendar, courses, upload, extract, review, confirm, effort survey, plan,
 * then sixteen weekly replans with work completed and missed along the way. Nothing is
 * shortcut and no engine is called directly; if a step is wrong for a student it is wrong here.
 *
 * The four courses come from four different institutions, which is a property of the corpus
 * rather than of student life. A real student's courses share one academic calendar; these do
 * not, so the term below is the union of what the four documents state and every place they
 * disagree is reported rather than smoothed over.
 *
 *   node tools/e2e/semester4/run.mjs            # against a Worker on 8787
 *
 * Findings are printed as they happen and summarised at the end. Exit code is always 0: this
 * is an instrument, not a gate, and a finding is a result rather than a failure.
 */
import { readFileSync } from "node:fs";

const API = process.env.SQ_API ?? "http://127.0.0.1:8787";
const DIR = new URL(".", import.meta.url).pathname;
const PAGES = JSON.parse(readFileSync(`${DIR}pages.json`, "utf8"));
/** The genuine PDFs, uploaded through the real multipart endpoint rather than faked. */
const PDF_DIR =
  process.env.SQ_PDFS ??
  "/tmp/claude-0/-home-user-SchoolQuest/e4b63fe0-4b59-5c4f-9649-ae9e55810398/scratchpad/corpus/semester4_spring2023/semester4_spring2023/";

/** Every defect the run turns up, with the document and the step that produced it. */
const findings = [];
const finding = (where, what) => {
  findings.push({ where, what });
  console.log(`  ⚑ ${where}: ${what}`);
};

let token = null;
async function api(path, method = "GET", body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------- the term calendar, first.
/**
 * Assembled from what the four documents actually state, not from a registrar page — because
 * no two of them share a registrar.
 *
 *   Richland  "The Spring 2023 semester begins January 17 and ends May 15", spring break
 *             "Week 9, March 13-19", "Finals Week, May 8–13".
 *   UNC       schedule opens "Jan 10/12"; "Mar 13-17 ** ENJOY SPRING BREAK!**"; final due May 8.
 *   WSU       "The first class is on Thursday, January 19, 2023"; "March 16, 2023: No Class
 *             Spring Break"; last class April 27.
 *   TAMUT     no dates at all — seventeen numbered weeks, "Week 9 Spring break".
 *
 * All four agree on the week of 13 March. They do not agree on when the term starts, so the
 * term spans the earliest start to the latest end and the disagreement is recorded.
 */
const TERM = { name: "Spring 2023", startDate: "2023-01-09", endDate: "2023-05-15" };
const BREAK = { start: "2023-03-13", end: "2023-03-19" };
const FINALS = { start: "2023-05-08", end: "2023-05-13" };

const COURSES = [
  { key: "richland_math104", name: "Technical Mathematics", code: "Math 104" },
  { key: "tamut_cosc1315", name: "Introduction to CS", code: "COSC 1315" },
  { key: "unc_geog062", name: "The Culture of Technology", code: "GEOG 062" },
  { key: "wsu_familylaw", name: "Family Law", code: "Family Law" },
];

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (dateOnly, n) => {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

async function main() {
  console.log(`\n=== SEMESTER 4 — Spring 2023, four real syllabi ===\n`);

  // ---- 1. Sign in as a fresh student.
  const email = `semester4-${Date.now()}@example.edu`;
  const login = await api("/api/auth/login", "POST", { email });
  const cb = await api("/api/auth/callback", "POST", {
    token: new URL(login.devLoginUrl).searchParams.get("token"),
  });
  token = cb.sessionToken;
  console.log(`1. signed in as ${email}`);

  // ---- 2. The term, then its calendar. In that order, and before any syllabus is read.
  const { term } = await api("/api/terms", "POST", TERM);
  const exceptions = [];
  for (let d = BREAK.start; d <= BREAK.end; d = addDays(d, 1)) {
    exceptions.push({ date: d, kind: "no_class", label: "Spring Break", followsWeekday: null });
  }
  for (let d = FINALS.start; d <= FINALS.end; d = addDays(d, 1)) {
    exceptions.push({ date: d, kind: "finals", label: "Finals Week", followsWeekday: null });
  }
  await api(`/api/terms/${term.id}`, "PATCH", {
    calendar: { exceptions, breaksTakeWeekNumbers: true },
  });
  const cal = await api(`/api/terms/${term.id}/calendar`);
  console.log(
    `2. term ${TERM.startDate}..${TERM.endDate}, ${exceptions.length} calendar exceptions, ` +
      `${cal.weeks?.length ?? "?"} academic weeks`,
  );
  finding(
    "term calendar",
    "the four syllabi state four different term starts (UNC Jan 10, Richland Jan 17, WSU Jan 19, TAMUT none); " +
      "the term spans the union, so week numbers in each document are read against a start none of them printed",
  );
  finding(
    "term calendar",
    "UNC's \"No class – Well-being day\" on Feb 14 and Apr 6 applies to one course, and TermCalendarException " +
      "has no course field, so it cannot be recorded without making it a day off for all four",
  );

  // ---- 3. Availability, so there is somewhere to put the work.
  await api(`/api/terms/${term.id}/availability-rules`, "PUT", {
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: dayOfWeek === 0 || dayOfWeek === 6 ? "10:00" : "17:00",
      endTime: dayOfWeek === 0 || dayOfWeek === 6 ? "16:00" : "21:00",
      energyLevel: "medium",
      location: "anywhere",
      hardness: "soft",
    })),
  });

  // ---- 4. Courses, uploads, extraction — one syllabus at a time.
  const created = [];
  for (const course of COURSES) {
    const { course: row } = await api(`/api/terms/${term.id}/courses`, "POST", {
      name: course.name,
      code: course.code,
    });
    // The real upload path: a multipart POST of the actual PDF, exactly as the browser sends
    // it. The Worker stores the bytes in R2 and returns a document row; page text is extracted
    // client-side by pdf.js and posted separately, which is the split the 10ms CPU limit forces.
    const form = new FormData();
    form.set("file", new Blob([readFileSync(`${PDF_DIR}${course.key}_spring2023.pdf`)], { type: "application/pdf" }), `${course.key}.pdf`);
    form.set("type", "syllabus");
    const upload = await fetch(`${API}/api/courses/${row.id}/documents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    if (!upload.ok) throw new Error(`upload ${course.key} -> ${upload.status}: ${await upload.text()}`);
    const { document } = await upload.json();
    const pages = PAGES[course.key];
    const result = await api(`/api/documents/${document.id}/extract`, "POST", { pages });
    created.push({ ...course, courseId: row.id, documentId: document.id });

    const claims = await api(`/api/documents/${document.id}/extraction`);
    const kinds = {};
    for (const c of claims.claims ?? []) kinds[c.claimType] = (kinds[c.claimType] ?? 0) + 1;
    console.log(
      `\n4. ${course.code}: ${pages.length} pages -> ` +
        Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(", ") +
        `${result.rejected?.length ? `, ${result.rejected.length} REJECTED` : ""}`,
    );
    for (const r of result.rejected ?? []) finding(course.code, `claim rejected (${r.reason}): "${r.title}"`);
    for (const w of result.warnings ?? []) finding(course.code, `warning: ${w}`);

    // What the student would see in review: every assignment claim and how sure the app is.
    const assignments = (claims.claims ?? []).filter((c) => c.claimType === "assignment");
    const byStatus = {};
    for (const a of assignments) {
      const k = a.payload.confidenceStatus ?? "unknown";
      byStatus[k] = (byStatus[k] ?? 0) + 1;
    }
    const undated = assignments.filter((a) => !a.payload.dueDate?.iso).length;
    // Every distinct issue the validator raised on this document, with how many items carry it.
    const issues = {};
    for (const a of assignments) for (const i of a.payload.issues ?? []) issues[i] = (issues[i] ?? 0) + 1;
    if (Object.keys(issues).length) {
      console.log(`   issues: ${Object.entries(issues).map(([k, v]) => `${k}×${v}`).join(", ")}`);
    }
    console.log(
      `   assignments ${assignments.length} (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}), ` +
        `${undated} with no resolved date`,
    );
    if (undated === assignments.length && assignments.length > 0) {
      finding(course.code, `not one of its ${assignments.length} assignments got a date from the document`);
    }

    /**
     * Answer the weekday question, the way a student would.
     *
     * A week number names a range, not a day, so the app refuses to invent one and asks. Until
     * that is answered every week-numbered item sits at AMBIGUOUS_DATE with no date at all —
     * which is the correct refusal and also, on COSC 1315, all ten of its assignments.
     *
     * Friday is the answer a student would give for weekly coursework, and it is the one that
     * makes the duplicate "Week 10" in Math 104 and the numbered break in COSC 1315 actually
     * bite, rather than being resolved away by never asking.
     */
    if (assignments.some((a) => (a.payload.issues ?? []).includes("AMBIGUOUS_DATE"))) {
      const answer = await api(`/api/documents/${document.id}/extraction/resolve-weekday`, "POST", {
        weekday: "Friday",
      });
      console.log(
        `   answered "which weekday": ${answer.resolved?.length ?? 0} dated, ` +
          `${answer.unresolved?.length ?? 0} still not`,
      );
      for (const r of (answer.resolved ?? []).filter((x) => x.needsAttention)) {
        finding(course.code, `dated but flagged: "${r.title}" -> ${r.dueDate} (${r.reason})`);
      }
      for (const u of answer.unresolved ?? []) {
        finding(course.code, `weekday answer did not date "${u.title}": ${u.reason}`);
      }
    }

    // Re-read: the weekday answer rewrote dates on the claims.
    const after = await api(`/api/documents/${document.id}/extraction`);
    const dated = (after.claims ?? []).filter(
      (c) => c.claimType === "assignment" && c.payload.dueDate?.iso,
    );
    console.log(`   after answering: ${dated.length}/${assignments.length} assignments have a date`);

    // Accept everything, the way a student who trusts the review would.
    const accept = (after.claims ?? [])
      .filter((c) => ["assignment", "grading_category", "meeting_pattern"].includes(c.claimType))
      .map((c) => c.id);
    const confirmed = await api(`/api/documents/${document.id}/extraction/confirm`, "POST", {
      acceptedClaimIds: accept,
    });
    console.log(
      `   confirmed: ${confirmed.created.workItems} work items, ` +
        `${confirmed.created.categories} categories, ${confirmed.created.meetingPatterns} meeting patterns`,
    );
  }

  // ---- 5. What is still unanswered, across the whole term.
  const open = await api(`/api/terms/${term.id}/open-questions`);
  console.log(
    `\n5. still unanswered: ${open.questionCount} across ${open.coursesAffected} of ${COURSES.length} courses`,
  );
  for (const c of open.courses) {
    for (const q of c.questions) console.log(`   ${c.courseLabel}: [${q.kind}] ${q.question.slice(0, 88)}`);
  }

  // ---- 6. The effort survey, answered one rung above the app's assumption.
  const survey = await api(`/api/terms/${term.id}/effort-survey`);
  console.log(
    `\n6. effort survey: ${survey.questions.length} questions cover ${survey.assumedItemCount} ` +
      `unestimated items (${Math.round(survey.groundedFraction * 100)}% grounded before answering)`,
  );
  const answers = survey.questions.map((q) => {
    const options = q.options.filter((o) => o.minutes > 0);
    const at = options.findIndex((o) => o.isCurrentAssumption);
    return { questionId: q.id, minutes: options[Math.min(at + 1, options.length - 1)].minutes };
  });
  if (answers.length) {
    const applied = await api(`/api/terms/${term.id}/effort-answers`, "POST", { answers });
    console.log(`   answered all ${answers.length}; now ${Math.round(applied.groundedFraction * 100)}% grounded`);
    if (applied.groundedFraction < 0.999) {
      finding("effort survey", `answering every question left ${Math.round((1 - applied.groundedFraction) * 100)}% still assumed`);
    }
  }

  // ---- 7. Walk the term, week by week, to finals.
  console.log(`\n7. walking the term week by week\n`);
  console.log(
    "   wk  monday       planned  done  missed   booked/cap   open  overdue  risks(at_risk)  courses",
  );
  const weeks = [];
  for (let d = "2023-01-09"; d <= TERM.endDate; d = addDays(d, 7)) weeks.push(d);

  let lastPlan = null;
  for (const [i, monday] of weeks.entries()) {
    const now = `${monday}T08:00:00.000Z`;
    const plan = await api(`/api/terms/${term.id}/plans/generate`, "POST", {
      horizonStart: monday,
      horizonDays: 7,
      now,
      preserveAcceptedSessions: false,
    });
    lastPlan = plan;
    const sessions = plan.sessions ?? [];
    const risks = plan.risks ?? [];
    const atRisk = risks.filter((r) => r.level === "at_risk");
    const courses = new Set(sessions.map((s) => s.courseId)).size;

    // Attend the week: most sessions done, a realistic share missed. Deterministic.
    let done = 0;
    let missed = 0;
    for (const s of sessions) {
      const roll = hash01(s.id);
      if (roll < 0.72) {
        await api(`/api/work-sessions/${s.id}/complete`, "POST", { outcome: "completed" });
        done += 1;
      } else if (roll < 0.86) {
        await api(`/api/work-sessions/${s.id}/complete`, "POST", { outcome: "did_not_start" });
        missed += 1;
      }
    }

    const board = await api(`/api/terms/${term.id}/plans/current`);
    const openItems = (board.workItems ?? []).filter(
      (w) => !["completed", "submitted", "canceled"].includes(w.status),
    ).length;
    const overdue = (board.workItems ?? []).filter(
      (w) => w.dueAt && w.dueAt < now && !["completed", "submitted", "canceled"].includes(w.status),
    ).length;

    console.log(
      `   ${String(i + 1).padStart(2)}  ${monday}  ${String(sessions.length).padStart(7)}` +
        `${String(done).padStart(6)}${String(missed).padStart(8)}` +
        `${String(`${plan.capacity?.usedMinutes ?? 0}/${plan.capacity?.availableMinutes ?? 0}`).padStart(13)}` +
        `${String(openItems).padStart(7)}${String(overdue).padStart(9)}` +
        `${String(`${risks.length}(${atRisk.length})`).padStart(16)}${String(`${courses}/4`).padStart(9)}`,
    );

    if (i === 0) {
      // What a student is actually told to do in their first week, by course.
      const byCourse = {};
      for (const s of sessions) {
        const item = (board.workItems ?? []).find((w) => w.id === s.workItemId);
        (byCourse[s.courseId] ??= new Set()).add(item?.title ?? s.workItemId);
      }
      for (const [, titles] of Object.entries(byCourse)) {
        console.log(`        week 1 asked for: ${[...titles].slice(0, 8).join(", ")}`);
      }
    }
    if (sessions.length === 0) finding(`week ${i + 1}`, `the plan came back empty on ${monday}`);
    for (const r of atRisk) {
      finding(`week ${i + 1}`, `at_risk: ${r.detail?.slice(0, 110)}`);
    }
  }

  // ---- 8. What the term ended with.
  const board = await api(`/api/terms/${term.id}/plans/current`);
  const items = board.workItems ?? [];
  const stillOpen = items.filter((w) => !["completed", "submitted", "canceled"].includes(w.status));
  console.log(
    `\n8. end of term: ${items.length} work items, ${items.length - stillOpen.length} finished, ` +
      `${stillOpen.length} still open`,
  );
  const openUndated = stillOpen.filter((w) => !w.dueAt).length;
  if (openUndated) finding("end of term", `${openUndated} of the ${stillOpen.length} unfinished items never had a due date`);

  console.log(`\n=== ${findings.length} findings ===`);
  const byWhere = {};
  for (const f of findings) (byWhere[f.where] ??= []).push(f.what);
  for (const [where, list] of Object.entries(byWhere)) {
    console.log(`\n${where}  (${list.length})`);
    for (const w of [...new Set(list)].slice(0, 6)) console.log(`   - ${w}`);
    if (new Set(list).size > 6) console.log(`   … and ${new Set(list).size - 6} more of the same shape`);
  }
  void lastPlan;
}

main().catch((e) => {
  console.error("\nRUN FAILED:", e.message);
  process.exitCode = 1;
});
