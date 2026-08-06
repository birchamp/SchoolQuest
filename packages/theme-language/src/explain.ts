import type { ThemeName } from "@schoolquest/domain";

/**
 * Reason codes → human sentences.
 *
 * This is deterministic on purpose. The AI coach may only paraphrase reasons that the
 * planner actually emitted, and this table is the ground truth it paraphrases from
 * (docs/06-ai-system-spec.md §11).
 */
const REASON_TEXT: Record<string, Record<ThemeName, string>> = {
  DEADLINE_IMMINENT: {
    quest: "the deadline is close",
    mission: "the deadline is close",
    plain: "the deadline is close",
  },
  DEADLINE_BUFFER_AT_RISK: {
    quest: "your safety margin before the deadline is shrinking",
    mission: "your margin before the deadline is shrinking",
    plain: "your buffer before the deadline is shrinking",
  },
  PRESERVES_DEADLINE_BUFFER: {
    quest: "it keeps a safety margin before the deadline",
    mission: "it protects margin before the deadline",
    plain: "it preserves buffer time before the deadline",
  },
  HIGH_ACADEMIC_VALUE: {
    quest: "it carries high course value",
    mission: "it carries high course value",
    plain: "it is worth a lot of your course grade",
  },
  UNLOCKS_MAJOR_PROJECT: {
    quest: "it unlocks the next stage of a major quest",
    mission: "it unlocks the next checkpoint of a primary objective",
    plain: "it unlocks the next step of a major project",
  },
  PREREQUISITE_FOR_LATER_WORK: {
    quest: "later work depends on it",
    mission: "later work depends on it",
    plain: "other work depends on finishing this first",
  },
  BEST_CONTEXT_WINDOW: {
    quest: "this is your strongest window for it",
    mission: "this is your best window for it",
    plain: "this is your best-matched time slot for it",
  },
  MATCHES_ENERGY_LEVEL: {
    quest: "it matches your energy in this window",
    mission: "it matches your energy in this window",
    plain: "the task's difficulty matches your energy then",
  },
  LOCATION_MATCH: {
    quest: "you will be somewhere that supports it",
    mission: "you will be at a location that supports it",
    plain: "you will be in the right place for it",
  },
  SPACED_PRACTICE: {
    quest: "spacing this out beats cramming",
    mission: "distributed practice beats cramming",
    plain: "spreading this out works better than cramming",
  },
  NEGLECTED_WORK: {
    quest: "it has not had attention in a while",
    mission: "it has not had attention in a while",
    plain: "you have not worked on it recently",
  },
  USER_PRIORITIZED: {
    quest: "you marked it important",
    mission: "you marked it important",
    plain: "you marked it as a priority",
  },
  COURSE_NEEDS_ATTENTION: {
    quest: "this course has the most room to improve",
    mission: "this course has the most room to improve",
    plain: "this course has the most improvement potential right now",
  },
  UNCERTAIN_INPUT_CONSERVATIVE: {
    quest: "some details are unconfirmed, so this is a cautious estimate",
    mission: "some details are unconfirmed, so this is a cautious estimate",
    plain: "some details are unconfirmed, so this is planned conservatively",
  },
  ONLY_REMAINING_WINDOW: {
    quest: "this is the only window left before it is due",
    mission: "this is the last available window before it is due",
    plain: "this is the only remaining time before it is due",
  },
  FITS_AVAILABLE_TIME: {
    quest: "it fits the time you have",
    mission: "it fits the time available",
    plain: "it fits in the time you have free",
  },
};

const TRADEOFF_TEXT: Record<string, string> = {
  READING_MOVED_TO_LOW_ENERGY_WINDOW: "Your reading moved to a lower-energy window.",
  LOWER_VALUE_WORK_DEFERRED: "Lower-value work moved later in the week.",
  SESSION_SHORTENED: "This session is shorter than the ideal length.",
  WORK_PUSHED_CLOSER_TO_DEADLINE: "Some work now sits closer to its deadline than usual.",
  DAILY_LIMIT_REACHED: "This session was trimmed to stay under your daily limit.",
};

const RISK_TEXT: Record<string, string> = {
  INSUFFICIENT_CAPACITY: "There is not enough time this week to finish everything.",
  PREREQUISITE_LATE: "A prerequisite step is running late.",
  NO_FEASIBLE_WINDOW: "No available window fits this before it is due.",
  DUE_DATE_UNCONFIRMED: "This due date has not been confirmed.",
  DUE_DATE_UNKNOWN: "No due date is known for this yet, so it is not being treated as urgent.",
  EFFORT_UNKNOWN: "The time this takes is still a guess.",
  DAILY_LIMIT_EXCEEDED: "This day exceeds your daily study limit.",
  OVER_HORIZON: "This falls outside the planned week.",
  WAITING_ITS_TURN: "Not this week — it is not due yet, and there is time.",
  // Without this the screen printed the raw code, lowercased: "paced to deadline · 4 items",
  // sitting unpunctuated among four proper sentences.
  PACED_TO_DEADLINE: "Being worked through steadily rather than crammed in at the end.",
};

export function explainReason(code: string, theme: ThemeName = "plain"): string {
  return REASON_TEXT[code]?.[theme] ?? code.toLowerCase().replace(/_/g, " ");
}

export function explainTradeoff(code: string | null): string | null {
  if (!code) return null;
  return TRADEOFF_TEXT[code] ?? null;
}

export function explainRisk(code: string): string {
  return RISK_TEXT[code] ?? code.toLowerCase().replace(/_/g, " ");
}

/**
 * Builds the "why this now?" sentence every recommendation must carry (docs/02-prd.md FR-11).
 * Caps at three reasons — a wall of justification is its own cognitive load.
 */
export function explainRecommendation(
  title: string,
  reasonCodes: string[],
  theme: ThemeName = "plain",
): string {
  const reasons = reasonCodes.slice(0, 3).map((code) => explainReason(code, theme));
  if (reasons.length === 0) return `Work on ${title}.`;
  if (reasons.length === 1) return `Work on ${title} because ${reasons[0]}.`;
  const last = reasons.pop()!;
  return `Work on ${title} because ${reasons.join(", ")}, and ${last}.`;
}

/**
 * Encounter kinds → a name and a one-line hint.
 *
 * The planning engine classifies each beat of the week from real fields (see
 * `docs/07-session-prep-design.md`); this is where those neutral codes are allowed to
 * become "gauntlet". The `plain` column is what screen readers get under every theme, so
 * the metaphor is always decoration — a student who cannot see the flavour still learns
 * exactly what kind of work the block holds.
 */
const BLOCK_KIND_TEXT: Record<
  string,
  Record<ThemeName, { name: string; hint: string }>
> = {
  major_assessment: {
    quest: { name: "Set piece", hint: "The encounter the week has been building toward." },
    mission: { name: "Primary action", hint: "The decisive item in this window." },
    plain: { name: "Major assessment", hint: "An exam, presentation, or imminent major deadline." },
  },
  back_to_back: {
    quest: { name: "Gauntlet", hint: "Several passes in a row. Pace yourself through it." },
    mission: { name: "Sustained run", hint: "Consecutive blocks. Plan the pacing." },
    plain: { name: "Back-to-back", hint: "Several blocks of this in one day." },
  },
  recurring: {
    quest: { name: "Ritual", hint: "The upkeep this questline asks for every week." },
    mission: { name: "Standing task", hint: "Recurring work on this theater." },
    plain: { name: "Recurring", hint: "Work that repeats through the term." },
  },
  first_pass: {
    quest: { name: "Reconnaissance", hint: "First look. Getting in is the whole goal." },
    mission: { name: "First pass", hint: "Initial survey. Opening the file is the objective." },
    plain: { name: "First pass", hint: "Not started yet — beginning is the goal." },
  },
  short_block: {
    quest: { name: "Skirmish", hint: "Short and contained." },
    mission: { name: "Short block", hint: "Brief and contained." },
    plain: { name: "Short block", hint: "Half an hour or less." },
  },
  sustained: {
    quest: { name: "Long march", hint: "Steady ground to cover." },
    mission: { name: "Extended block", hint: "Steady work through the window." },
    plain: { name: "Sustained work", hint: "A longer stretch of steady work." },
  },
};

export function explainBlockKind(
  kind: string,
  theme: ThemeName,
): { name: string; hint: string; plainName: string } {
  const entry = BLOCK_KIND_TEXT[kind];
  if (!entry) {
    // An unknown kind means the engine grew a category this table has not learned yet.
    // Showing the raw code is honest and obviously unfinished; inventing a name is not.
    return { name: kind, hint: "", plainName: kind };
  }
  return { ...entry[theme], plainName: entry.plain.name };
}

/**
 * Day load → wording.
 *
 * The load comes from minutes weighted by cognitive demand, which is why a short exam day
 * is never "light". Every theme keeps the four steps distinct and in the same order, so the
 * shape of a week reads the same whichever wording is on screen.
 */
const DAY_LOAD_TEXT: Record<string, Record<ThemeName, string>> = {
  heavy: { quest: "Perilous", mission: "High tempo", plain: "Heavy" },
  steady: { quest: "Steady march", mission: "Steady", plain: "Steady" },
  light: { quest: "Easy road", mission: "Light", plain: "Light" },
  clear: { quest: "Clear road", mission: "Clear", plain: "Clear" },
};

export function explainDayLoad(load: string, theme: ThemeName): string {
  return DAY_LOAD_TEXT[load]?.[theme] ?? load;
}

export function plainDayLoad(load: string): string {
  return DAY_LOAD_TEXT[load]?.plain ?? load;
}

/**
 * Upkeep — whether a course's routine work is being kept up.
 *
 * Deliberately not a score and not a streak: a course returns to "current" the instant its
 * overdue routine work is done, so there is nothing here to lose and nothing to protect. The
 * wording carries that; "slipping" is a description of two unfinished posts, not a verdict on
 * the student.
 */
const UPKEEP_TEXT: Record<string, Record<ThemeName, { label: string; hint: string }>> = {
  no_routine: {
    quest: { label: "No upkeep", hint: "This questline has no recurring work." },
    mission: { label: "No standing tasks", hint: "Nothing recurring in this theater." },
    plain: { label: "No recurring work", hint: "This course has no repeating assignments." },
  },
  current: {
    quest: { label: "Upkeep held", hint: "The recurring work of this questline is current." },
    mission: { label: "Standing tasks current", hint: "Recurring work is up to date." },
    plain: { label: "Recurring work current", hint: "Nothing repeating is overdue." },
  },
  slipping: {
    quest: { label: "Upkeep slipping", hint: "One piece of recurring work is past its date." },
    mission: { label: "One standing task late", hint: "One recurring item is past its date." },
    plain: { label: "One repeat overdue", hint: "One repeating assignment is past its date." },
  },
  behind: {
    quest: {
      label: "Upkeep behind",
      hint: "Several pieces of recurring work are past their dates. They are usually short.",
    },
    mission: {
      label: "Standing tasks behind",
      hint: "Several recurring items are past their dates. They are usually short.",
    },
    plain: {
      label: "Repeats overdue",
      hint: "Several repeating assignments are past their dates. They are usually short.",
    },
  },
};

export function explainUpkeep(
  status: string,
  theme: ThemeName,
): { label: string; hint: string; plainLabel: string } {
  const entry = UPKEEP_TEXT[status];
  if (!entry) return { label: status, hint: "", plainLabel: status };
  return { ...entry[theme], plainLabel: entry.plain.label };
}

/**
 * Course health — the dashboard's one-word verdict.
 *
 * Every wording here names a state of the *plan or the course*, never a state of the
 * student. "Needs a look" is a to-do; "falling behind" would be a judgement, and would also
 * be a loss mechanic in disguise (docs/02-prd.md §3). Nothing accumulates: a course returns
 * to steady the moment its concerns are addressed.
 *
 * The quest column stays on the Dungeon Master's side of the table — a questline in trouble
 * is a thread that needs the DM's attention before next session, not a player who failed.
 */
const HEALTH_TEXT: Record<string, Record<ThemeName, { label: string; hint: string }>> = {
  at_risk: {
    quest: {
      label: "Needs a call",
      hint: "Something here cannot be fixed by working harder — it needs a decision.",
    },
    mission: {
      label: "Decision needed",
      hint: "Something here needs a call, not more effort.",
    },
    plain: {
      label: "Needs a decision",
      hint: "Something here will not resolve by working harder.",
    },
  },
  needs_attention: {
    quest: {
      label: "Needs a look",
      hint: "Worth a few minutes before the next session; cheap to sort out now.",
    },
    mission: {
      label: "Action needed",
      hint: "Worth handling now while it is small.",
    },
    plain: {
      label: "Needs attention",
      hint: "Worth a few minutes now, while it is still small.",
    },
  },
  steady: {
    quest: { label: "Holding", hint: "Nothing needs you here right now." },
    mission: { label: "Nominal", hint: "Nothing needs you here right now." },
    plain: { label: "On track", hint: "Nothing needs you here right now." },
  },
};

export function explainHealth(
  level: string,
  theme: ThemeName,
): { label: string; hint: string; plainLabel: string } {
  const entry = HEALTH_TEXT[level];
  if (!entry) return { label: level, hint: "", plainLabel: level };
  return { ...entry[theme], plainLabel: entry.plain.label };
}
