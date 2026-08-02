/**
 * What the five fake syllabuses actually say a student has to do.
 *
 * The extraction eval measures *precision* — whether the model quoted text that is not in the
 * document — and that is the number it was built around, because a planner that invents an exam
 * is unusable. But precision cannot see the opposite failure, and the opposite failure is worse:
 * a student can plan around work they can see and cannot plan around a hole. Nothing in the
 * harness has ever asked "what did it miss".
 *
 * This is the answer key that makes recall measurable. Every entry quotes the sentence it comes
 * from, so an argument about whether something was really missed is settled by reading the
 * syllabus rather than by trusting this file.
 *
 * It is a **floor, not a census**. Where a syllabus states a count ("There are 14 logs") the
 * count is exact. Where it states a rule over the term ("due each Tuesday") the number is
 * derived from the instruction dates and marked `derived`, because a reasonable reader could
 * land a week either side. Recall is scored against the floor, so the score is never inflated by
 * this file guessing high.
 */

export interface ExpectedWork {
  /** How many separate pieces of work a student actually faces. */
  count: number;
  /** The sentence in the syllabus this comes from. */
  evidence: string;
  /**
   * True when the count comes from applying a stated rule across the term rather than from a
   * number printed in the document.
   */
  derived?: boolean;
  /** A date the syllabus states outright, for the entries where getting it wrong is the point. */
  statedDate?: string;
}

export interface CourseAnswerKey {
  code: string;
  /** Keyed by the work as a student would name it, not by the extractor's title. */
  expected: Record<string, ExpectedWork>;
}

/**
 * Instruction runs 24 August – 11 December 2026, which is sixteen weeks. Rules stated as "each
 * <weekday>" are counted across those weeks.
 */
export const SYLLABUS_ANSWER_KEY: CourseAnswerKey[] = [
  {
    code: "BIO 240",
    expected: {
      quizzes: {
        count: 13,
        evidence: "Weekly quizzes are given every Wednesday — the schedule table lists Quiz 1 to Quiz 13.",
      },
      exams: {
        count: 3,
        evidence: "There are three exams. ... Exam 1 is September 18, 2026. ... The final exam is December 16, 2026.",
      },
      labReports: {
        count: 1,
        evidence: 'Laboratory Reports 25%; the schedule lists a formal lab report due "Week 6".',
      },
      labNotebook: { count: 1, evidence: "Lab notebook due at the end of term." },
    },
  },
  {
    code: "HIS 210",
    expected: {
      readingQuizzes: {
        count: 13,
        evidence: "Reading quizzes each Friday; the schedule table enumerates Reading Quiz 1 to 13.",
      },
      essays: { count: 3, evidence: "Primary Source Essays 30% — three essays listed in the schedule." },
      researchPaper: { count: 1, evidence: "Research Paper 25%, due December 4." },
      topicApproval: { count: 1, evidence: "Paper topic approval due in October." },
      finalExam: { count: 1, evidence: "Final exam during finals week." },
    },
  },
  {
    code: "MAT 205",
    expected: {
      problemSets: { count: 6, evidence: "There are six problem sets. ... Problem Set 1 due Week 3 ... Week 14." },
      exams: {
        count: 3,
        evidence: "Exam 1 ... October 2, 2026. The date of Exam 2 will be announced. ... final exam ... December 14-18.",
      },
    },
  },
  {
    /**
     * The course that exposes the defect.
     *
     * Fourteen logs are stated as a number, in a sentence, and the extraction produced one
     * undated item. A student reading their own plan would see "Weekly Fitness Log" once and
     * have no reason to think there were thirteen more — for forty per cent of the grade.
     */
    code: "PED 110",
    expected: {
      fitnessLogs: {
        count: 14,
        evidence: "A weekly fitness log is due each Sunday by 9:00 pm ... There are 14 logs; the two lowest are dropped.",
      },
      assessments: {
        count: 3,
        evidence: "Baseline assessment: September 2, 2026 ... Midterm: October 14, 2026 ... Final: December 9, 2026.",
        statedDate: "2026-09-02",
      },
    },
  },
  {
    code: "ENG 230",
    expected: {
      workshopSubmissions: {
        count: 4,
        evidence: "Each student submits four pieces for workshop ... Submission 1 during Sept. 14-18, 2026 ...",
      },
      readingResponses: {
        count: 16,
        derived: true,
        evidence: "A short response to the assigned reading is due each Tuesday in class.",
      },
      finalPortfolio: { count: 1, evidence: "The portfolio is due December 9 and is worth 25%." },
    },
  },
];

/** Everything a student in this fake semester is actually on the hook for. */
export function expectedWorkTotal(): number {
  return SYLLABUS_ANSWER_KEY.reduce(
    (sum, course) => sum + Object.values(course.expected).reduce((n, e) => n + e.count, 0),
    0,
  );
}
