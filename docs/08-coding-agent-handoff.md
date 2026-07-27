# Coding Agent Handoff

## 1. Recommended implementation strategy

Build a responsive TypeScript web application first. Keep planning logic in a testable domain package, separate from UI and AI providers.

Suggested stack:

- Frontend: Next.js, React, TypeScript
- Styling: Tailwind CSS plus accessible headless components
- Calendar interactions: custom grid or a carefully evaluated calendar library
- Backend: Next.js server routes or a separate TypeScript service
- Database: PostgreSQL with Prisma or Drizzle
- Object storage: S3-compatible storage
- Jobs: durable queue for document processing and plan generation
- AI: provider abstraction with schema-constrained responses
- PDF parsing: deterministic text/table extraction plus page rendering where needed
- Authentication: established managed provider or mature auth library
- Testing: Vitest/Jest, React Testing Library, Playwright

## 2. Repository structure

```text
/apps
  /web
  /worker
/packages
  /domain
  /planning-engine
  /ai-contracts
  /theme-language
  /ui
  /test-fixtures
/docs
```

## 3. Architectural boundaries

### Domain package

Contains theme-neutral entities, validation, status transitions, and grade math.

### Planning-engine package

Pure functions where practical. Inputs are normalized records; outputs are plan versions, sessions, reason codes, and risks.

### AI-contracts package

JSON schemas, provider interfaces, prompt versions, extraction confidence, and evaluation fixtures.

### Theme-language package

Maps semantic keys to Quest, Mission, and Plain labels. No database schema or business rule should use themed words.

## 4. First vertical slice

Implement this before broad feature work:

1. Create one term.
2. Add two courses manually.
3. Add fixed weekly commitments.
4. Add one weekly quiz, one reading, and one paper with milestones.
5. Generate a week.
6. Show a Today recommendation and reason.
7. Move a session.
8. Mark a day lost and produce a minimal-change replan.

This proves the central value before PDF and chat complexity.

## 5. Second vertical slice

1. Upload one syllabus PDF.
2. Extract assignment candidates with source pages.
3. Confirm them in review UI.
4. Feed them into the same planning engine.

## 6. Engineering rules

- Never let an LLM write directly to confirmed academic records.
- All AI outputs pass schema validation.
- Store evidence and prompt/model version for extraction claims.
- Planning is reproducible and testable without an LLM.
- Plan changes create versions and diffs.
- Every recommendation includes machine-readable reason codes.
- User edits always outrank inferred preferences.
- Unknown is a valid state.
- Use feature flags for screenshot import and coach actions.

## 7. Initial domain interfaces

```ts
export interface WorkItem {
  id: string;
  courseId: string;
  title: string;
  type: WorkType;
  dueAt?: string;
  pointsPossible?: number;
  estimatedMinutes?: number;
  remainingMinutes?: number;
  cognitiveDemand: "low" | "medium" | "high";
  status: WorkStatus;
  confidence: ConfidenceStatus;
}

export interface PlanningResult {
  planVersionId: string;
  sessions: PlannedSession[];
  recommendations: Recommendation[];
  risks: PlanningRisk[];
  unscheduledWorkItemIds: string[];
}
```

## 8. Suggested initial tickets

1. Establish monorepo, CI, linting, formatting, and test framework.
2. Implement domain entities and Zod schemas.
3. Implement terms, courses, commitments, and work-item persistence.
4. Create fixture semester with two courses.
5. Build availability-grid calculation.
6. Build first priority-score function with reason codes.
7. Build heuristic session placer.
8. Add plan versioning and stable-movement cost.
9. Build Today recommendation endpoint.
10. Build Week Map read-only UI.
11. Add move and lock interactions.
12. Add session outcomes and remaining-effort update.
13. Add disruption event and replan diff.
14. Add theme-language token layer.
15. Add PDF upload and processing job.
16. Define syllabus extraction JSON schema.
17. Build extraction review interface.
18. Add milestone decomposition behind review.

## 9. Definition of done for each feature

- Domain behavior has unit tests.
- API input and output are schema validated.
- Loading, empty, error, and uncertain states are designed.
- Keyboard path is tested for primary action.
- Automated changes are auditable.
- Theme terminology is not hard-coded in domain logic.
- Analytics events do not include document text or sensitive grades.
- Acceptance criteria in the PRD are met.

## 10. Seed scenario

Use this scenario for demos and regression tests:

- Psychology course: weekly reading and quiz; 250-point paper due in four weeks.
- Education course: weekly reading; smaller quizzes; major childhood-education project due in six weeks.
- Student works two evening shifts and has fixed class meetings.
- Student has a 90-minute library window Tuesday afternoon.
- Psychology is currently the weaker course.
- Paper source research must occur before outlining.
- A missed Monday should cause minimal replanning, not a full schedule rewrite.

Expected recommendation:

The Tuesday library window should favor psychology source research over low-value reading, while showing when the reading is protected later.

## 11. Coding-agent launch prompt

> Build the first vertical slice described in `08-coding-agent-handoff.md`. Treat `02-prd.md` and `04-planning-engine-spec.md` as authoritative. Use a TypeScript monorepo with a pure, independently tested planning-engine package. Start with the seed scenario, implement reason-coded recommendations and minimal-change replanning, and do not add PDF extraction or chat until the complete vertical slice passes unit and end-to-end tests. Keep all domain language theme-neutral and map visual terminology through a theme-language package.
