# Product Requirements Document

## 1. Purpose

Build a responsive web application that converts academic documents and student constraints into an adaptive semester and weekly work plan. The product must support an optional gamified interface without making academic data dependent on game terminology.

## 2. Goals

- Prevent long-term assignments from becoming last-minute emergencies.
- Allocate scarce high-quality focus time according to academic impact, risk, and prerequisite timing.
- Reduce the number of planning decisions required each day.
- Maintain student confidence that deferred work remains tracked.
- Make plan changes easy after disruptions.
- Use grades as planning feedback rather than as shame-based rewards.

## 3. Non-goals

- Replace the institution's learning-management system.
- Guarantee grades or academic outcomes.
- Decide whether a student should skip required work without showing the tradeoff.
- Encourage compulsive engagement through streak loss, random rewards, or fear-based notifications.

## 4. Functional requirements

### FR-1: Term management

The user can create, edit, archive, and duplicate an academic term.

Required fields:

- Term name
- Start and end dates
- Time zone
- Default weekly availability

Acceptance criteria:

- A term cannot end before it starts.
- Archived terms do not appear in active planning.
- Term dates constrain course and assignment suggestions but may be overridden.

### FR-2: Course setup

The user can add a course manually or by uploading a syllabus.

Course fields:

- Name and short code
- Instructor
- Meeting pattern and location
- Credits or expected weekly effort
- Course color/icon
- Grading categories and weights
- Preferred terminology theme override, optional

Acceptance criteria:

- Class times are fixed busy blocks.
- The app asks for missing class times when extraction confidence is low or no schedule is found.
- Course records remain usable without a syllabus.

### FR-3: Syllabus ingestion

The user uploads a PDF. The system extracts:

- Course identity
- Meeting dates and times
- Instructor details
- Assignments, exams, quizzes, readings, labs, and projects
- Due dates and times
- Point values or percentage weights
- Grading categories
- Late-work policy
- Required materials
- Major-project instructions and intermediate deadlines

Each extracted item must include:

- Source page
- Source excerpt or bounding reference
- Confidence score
- Confirmation status

Acceptance criteria:

- Extraction never silently invents a date.
- Ambiguous dates are flagged.
- The user receives a review screen before items affect the plan.
- Duplicate assignment rows are detected and suggested for merging.
- The original PDF remains viewable beside extracted data.

### FR-4: Clarification interview

After extraction, the app asks a minimal set of targeted questions.

Possible questions:

- What days and times does this class meet?
- Is “Week 5” tied to a specific calendar date?
- Does this project have a topic-approval deadline?
- How long does a normal chapter reading take you?
- Is this assignment optional, dropped, or extra credit?

Acceptance criteria:

- Questions are grouped by course and urgency.
- The user can answer “I don't know yet.”
- Unknown answers remain visible as planning uncertainty.

### FR-5: Assignment model

The user can create and edit academic work items.

Assignment attributes:

- Course
- Title and description
- Type
- Due date/time
- Available/start date
- Point value
- Category weight
- Estimated effort
- Cognitive demand
- Submission method
- Dependencies
- Status
- Grade status and result

Acceptance criteria:

- Due-date edits trigger a plan impact preview.
- The user can mark an assignment canceled, optional, or already completed.
- Missing effort estimates can be inferred but remain editable.

### FR-6: Major project decomposition

For major assignments and exams, the system proposes milestones.

Examples for a research paper:

1. Read prompt and rubric.
2. Select or confirm topic.
3. Find preliminary sources.
4. Confirm thesis or research question.
5. Create outline.
6. Draft sections.
7. Complete full draft.
8. Revise against rubric.
9. Proofread and submit.

Examples for an exam:

1. Gather study scope.
2. Identify weak units.
3. Build study materials.
4. Practice recall.
5. Complete practice exam.
6. Review errors.

Acceptance criteria:

- Milestones are editable, reorderable, and removable.
- Dependencies can be represented.
- Early prerequisite work is scheduled before later work.
- The user can choose “make this simpler” to reduce steps.
- Each milestone has an estimated duration and preferred completion window.

### FR-7: Recurring commitments

The user can add work shifts, meals, sleep targets, commute, appointments, clubs, worship, exercise, and other commitments.

Acceptance criteria:

- Commitments may be fixed, flexible, or optional.
- Recurrence supports common weekly patterns.
- A changed occurrence can affect only that occurrence or the whole series.

### FR-8: Availability and work preferences

The student can define:

- Earliest and latest work times
- Preferred session lengths
- Break preferences
- High-, medium-, and low-energy periods
- Maximum academic hours per day
- Days or periods to protect
- Environment constraints such as library-only tasks

Acceptance criteria:

- The scheduler respects hard constraints.
- Soft preferences may be violated only with explanation.
- The user can override any proposed work block.

### FR-9: Weekly plan generation

The app creates a proposed week containing fixed events and academic work sessions.

Each suggested work session includes:

- Assignment or milestone
- Duration
- Course
- Why it is scheduled then
- Flexibility level
- Consequence of moving it

Acceptance criteria:

- Recurring work and major-project milestones can coexist in the same week.
- The plan preserves buffer before important deadlines.
- High-value, high-risk tasks receive suitable focus periods.
- The plan does not exceed daily limits without explicit warning.
- Unscheduled required work appears in a visible planning-risk panel.

### FR-10: Week Map

The Week Map shows:

- Calendar grid
- Fixed commitments
- Planned academic sessions
- Major quest/project lanes
- Weekly priorities
- Capacity used versus available
- Near-future obligations

Acceptance criteria:

- The current week is visually clear.
- Future work is visible but de-emphasized.
- The student can open a major project to see its entire path.
- Dragging a block previews downstream effects.
- Keyboard-based movement is supported.

### FR-11: Today view

The Today view presents:

- One primary recommended action
- Up to two alternatives
- Current fixed events
- A compact view of what is protected later
- Start, shorten, move, skip, or ask-coach actions

Acceptance criteria:

- The primary recommendation has a plain-language rationale.
- The user can start a timer or simply mark the session started.
- The system does not present a long undifferentiated task list by default.

### FR-12: Session outcome

At the end of a work session, the user can report:

- Completed
- Partially completed
- Did not start
- Took less time
- Took more time
- Blocked by missing information
- Needs another session

Acceptance criteria:

- A two-tap completion path exists.
- Partial completion can update remaining effort.
- The plan recalculates without punitive copy.

### FR-13: Fast replanning

The user can report a disruption in natural language or through quick actions.

Acceptance criteria:

- The system proposes changes rather than immediately applying major ones.
- Locked blocks remain unchanged.
- The revised plan states what moved, what is at risk, and why.
- The user may accept all, inspect changes, or adjust manually.

### FR-14: Grades and outcomes

The user can manually enter grades or upload a screenshot for extraction.

Grade attributes:

- Assignment
- Score earned
- Score possible
- Letter result, optional
- Category
- Posted date
- Confirmation status

Acceptance criteria:

- The system can operate with unknown grades.
- Pending grades do not count as zero.
- Extracted grades require review.
- Course standing estimates show uncertainty when grading data is incomplete.
- The app may recommend reallocating time between courses, but must explain the tradeoff.

### FR-15: Coach chat

The student can ask questions such as:

- What should I do now?
- Why is this more important than my reading?
- I only have 25 minutes.
- I missed yesterday. Fix my week.
- What happens if I move this to Friday?
- Break this assignment into smaller steps.

Acceptance criteria:

- Responses use current plan data.
- Recommendations link to editable schedule actions.
- The coach distinguishes confirmed facts from assumptions.
- It does not claim to know an instructor's intent beyond supplied evidence.

### FR-16: Themes and terminology

Supported initial themes:

- Quest
- Mission
- Plain

Acceptance criteria:

- Theme can change without data migration.
- All critical actions remain understandable without metaphor.
- The app does not require D&D knowledge.

### FR-17: Notifications

Notifications may include:

- Today's first recommended action
- Upcoming fixed event
- A major project needs an early prerequisite
- Plan requires review after a changed deadline
- Grade information could improve planning

Acceptance criteria:

- Notifications are configurable.
- No streak-loss or shame language.
- Repeated ignored notifications reduce automatically.

## 5. Nonfunctional requirements

### Performance

- Week Map initial load under 2 seconds on a typical broadband connection.
- Local interactions such as moving a block feel immediate.
- Planning recalculation target under 5 seconds for one semester.

### Reliability

- User edits are persisted immediately.
- Schedule generation is idempotent for unchanged inputs and seed.
- Every automated plan change is auditable.

### Accessibility

- WCAG 2.2 AA target.
- Full keyboard navigation for core planning flows.
- Reduced-motion mode.
- Color is never the sole status indicator.
- Screen-reader labels use plain terminology, even when a visual theme is active.

### Privacy

- Encrypt data in transit and at rest.
- Restrict uploaded academic documents to the user.
- Allow account and document deletion.
- Strip screenshot metadata where feasible.
- Do not use user content to train shared models without explicit consent.

### Explainability

Every priority score and schedule suggestion should be decomposable into human-readable factors such as deadline, value, risk, prerequisite need, estimated effort, course standing, and available focus windows.

## 6. Core user stories

1. As a student, I upload a syllabus and review the assignments the app found so I do not have to enter the whole semester manually.
2. As a student, I see the best next action so I can begin without comparing twenty tasks.
3. As a student, I inspect a major project path so I know early preparation is included.
4. As a student, I move a suggested block and see the consequence before committing.
5. As a student, I report a lost day and receive a realistic revised week.
6. As a student, I enter a grade and see whether the strategy should change.
7. As a student, I can use game language because it makes planning meaningful, but switch to plain language at any time.
8. As a student, I see future commitments in a quiet visual layer, which reassures me without overwhelming me.

## 7. Release acceptance

The MVP is releasable when a student can:

- Create a term and at least two courses.
- Upload and review syllabus-derived assignments.
- Add fixed weekly commitments.
- Generate a feasible week.
- View and edit a major project path.
- Start and complete a recommended session.
- Lose a day and replan.
- Add a grade and receive an explainable priority update.
- Change terminology themes.
