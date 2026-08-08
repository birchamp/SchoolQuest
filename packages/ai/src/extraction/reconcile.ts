import type { SyllabusExtraction, ExtractedAssignment, ScheduleAnchor } from "./schema.js";

/**
 * Several readings of one syllabus, reduced to one answer plus an honest account of the
 * disagreement.
 *
 * ## Why read it more than once
 *
 * The evidence check catches a claim the document does not support. It cannot catch a claim the
 * document supports and the model simply *missed* — and on real syllabi that is the commoner
 * failure. Recall against the fixture corpus was 67% before recurrence handling, and every miss
 * was a real assignment that one reading did not mention.
 *
 * A second reading of the same pages misses different things. So the useful question is not
 * "what did the model say" but "what did it say every time", and the gap between those two is a
 * measurement rather than a guess: an item found in three runs of three is a different kind of
 * fact from one found in one of three, and the student deserves to be told which they are
 * looking at.
 *
 * ## Why the merge is code and not a model
 *
 * Nothing here asks anything. It is set arithmetic over claim identities, so the same runs
 * always reduce to the same answer, a disagreement can be reproduced from the saved runs, and
 * the reconciliation cannot itself hallucinate. Asking a model to "combine these three
 * extractions" would put the one step that is supposed to be trustworthy back inside the thing
 * being checked.
 *
 * ## What agreement is *not*
 *
 * It is not accuracy. Three runs of a model that reads a table wrong the same way agree
 * perfectly. Agreement measures stability, which is worth having and is not the same thing —
 * `verifyEvidence` remains the check on whether a claim is true, and this is the check on
 * whether it is reliably found.
 */

/** How a claim fared across the runs. */
export interface Agreement {
  /** Runs that produced this claim. */
  found: number;
  /** Runs there were. */
  outOf: number;
  /**
   * Set when runs agreed the claim exists and disagreed about its date.
   *
   * The strongest signal in the whole reconciliation, and the one worth surfacing first: the
   * document said something two readers read differently, which usually means it says it twice.
   */
  conflictingValues: string[];
}

export interface ReconciledExtraction {
  /** The merged reading, containing every claim any run produced. */
  extraction: SyllabusExtraction;
  /** Keyed by the same identity used to merge, so a caller can look up any claim's standing. */
  agreement: Record<string, Agreement>;
  /** Claims every run found. The ones worth showing a student without a caveat. */
  unanimous: string[];
  /** Claims some runs missed, and how many. Ordered worst-first. */
  contested: { key: string; found: number; outOf: number }[];
  /** Claims where runs found the same item with different dates. */
  contradictions: { key: string; values: string[] }[];
}

/** Normalised so trivial differences in spacing or case do not read as disagreement. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A claim's identity, stable across runs.
 *
 * Title and type rather than title alone: "Exam 1" as a `quiz` in one reading and an `exam` in
 * another is a genuine disagreement about what the work *is*, and collapsing them would hide it.
 * Deliberately not the date — the whole point is to notice when two runs date one item
 * differently, which is impossible if the date is part of what makes them the same item.
 */
export function assignmentKey(a: ExtractedAssignment): string {
  return `assignment:${norm(a.title)}:${a.type}`;
}

const anchorKey = (a: ScheduleAnchor) => `anchor:${a.weekNumber}:${norm(a.raw ?? "")}`;

/** The value compared for contradictions once two runs agree an item exists. */
const dateValue = (a: ExtractedAssignment) => a.dueDate.iso ?? a.dueDate.raw ?? "(none)";

export function reconcileExtractions(runs: SyllabusExtraction[]): ReconciledExtraction {
  if (runs.length === 0) throw new Error("reconcileExtractions needs at least one run");
  const outOf = runs.length;

  const seen = new Map<string, { found: Set<number>; values: Set<string> }>();
  const record = (key: string, run: number, value?: string) => {
    const entry = seen.get(key) ?? { found: new Set<number>(), values: new Set<string>() };
    entry.found.add(run);
    if (value !== undefined) entry.values.add(value);
    seen.set(key, entry);
    return entry;
  };

  /**
   * First run wins the *content* of a claim; later runs only vote on it.
   *
   * Merging field by field across runs would invent a reading no model produced — a title from
   * one and a date from another, evidence pointing at neither. Every claim that survives here is
   * exactly as some run wrote it, which keeps the evidence check meaningful downstream.
   */
  const assignments: ExtractedAssignment[] = [];
  const anchors: ScheduleAnchor[] = [];

  for (const [i, run] of runs.entries()) {
    for (const a of run.assignments) {
      const key = assignmentKey(a);
      const before = seen.has(key);
      record(key, i, dateValue(a));
      if (!before) assignments.push(a);
    }
    for (const anchor of run.scheduleAnchors) {
      const key = anchorKey(anchor);
      const before = seen.has(key);
      record(key, i);
      if (!before) anchors.push(anchor);
    }
    for (const g of run.gradingCategories) record(`category:${norm(g.name)}`, i, String(g.weightPercent ?? g.pointsPossible ?? "?"));
    for (const p of run.policies) record(`policy:${p.kind}`, i);
  }

  const agreement: Record<string, Agreement> = {};
  for (const [key, entry] of seen) {
    agreement[key] = {
      found: entry.found.size,
      outOf,
      // One value is consensus, not conflict. Sorted so the report is stable.
      conflictingValues: entry.values.size > 1 ? [...entry.values].sort() : [],
    };
  }

  const unanimous = Object.entries(agreement)
    .filter(([, a]) => a.found === outOf && a.conflictingValues.length === 0)
    .map(([k]) => k)
    .sort();

  const contested = Object.entries(agreement)
    .filter(([, a]) => a.found < outOf)
    .map(([key, a]) => ({ key, found: a.found, outOf: a.outOf }))
    .sort((x, y) => x.found - y.found || x.key.localeCompare(y.key));

  const contradictions = Object.entries(agreement)
    .filter(([, a]) => a.conflictingValues.length > 1)
    .map(([key, a]) => ({ key, values: a.conflictingValues }))
    .sort((x, y) => x.key.localeCompare(y.key));

  /**
   * The union, not the intersection.
   *
   * Dropping a claim that only one run found would throw away a real assignment to buy a
   * cleaner-looking result — and a missing assignment is invisible to the student, while a
   * doubtful one is a line in the review queue. The agreement count travels alongside so the
   * caller can downgrade rather than delete.
   */
  const first = runs[0]!;
  return {
    extraction: {
      ...first,
      assignments,
      scheduleAnchors: anchors,
      gradingCategories: dedupeBy(runs.flatMap((r) => r.gradingCategories), (g) => norm(g.name)),
      meetingPatterns: dedupeBy(runs.flatMap((r) => r.meetingPatterns), (m) => `${m.daysOfWeek.join(",")}:${m.startTime}`),
      policies: dedupeBy(runs.flatMap((r) => r.policies), (p) => `${p.kind}:${norm(p.summary).slice(0, 60)}`),
      clarificationQuestions: dedupeBy(
        runs.flatMap((r) => r.clarificationQuestions),
        (q) => norm(q.question),
      ),
    },
    agreement,
    unanimous,
    contested,
    contradictions,
  };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * How sure the app should be about a claim, from how reliably it was found.
 *
 * Deliberately conservative at the top: unanimity across runs is not proof, only stability, so
 * the ceiling is `high_inference` and `confirmed` stays a thing only a student can say. That is
 * the same rule the confirm route follows for an item the student accepted.
 */
export function confidenceFromAgreement(a: Agreement | undefined): "high_inference" | "low_inference" | "unknown" {
  if (!a) return "unknown";
  if (a.conflictingValues.length > 1) return "low_inference";
  if (a.found === a.outOf) return "high_inference";
  if (a.found * 2 > a.outOf) return "low_inference";
  return "unknown";
}
