# MVP Roadmap

## Phase 0: Product and technical spike

Goals:

- Validate syllabus extraction against real documents.
- Prototype the Week Map and Today recommendation.
- Test whether quest language helps rather than distracts.
- Implement a simple deterministic scheduling heuristic.

Deliverables:

- Five to ten anonymized syllabus fixtures.
- Extraction schema and evaluation harness.
- Clickable UX prototype.
- Scheduler command-line prototype.
- User testing script.

Exit criteria:

- Dates and assignment values can be extracted with evidence.
- Test users understand “future work is protected.”
- Scheduler can handle a representative two-course week.

## Phase 1: Foundation

Epics:

- Authentication and profile
- Terms and courses
- Fixed commitments and availability
- Work-item CRUD
- Theme token architecture
- Audit events

Release slice:

A user can manually create a semester, courses, assignments, and recurring commitments.

## Phase 2: Syllabus intelligence

Epics:

- PDF storage and viewing
- Extraction service
- Review and correction workflow
- Clarification Inbox
- Grading category model

Release slice:

A user uploads a syllabus, confirms extracted information, and sees the semester workload.

## Phase 3: Project paths and planning

Epics:

- Major-project detection
- Milestone decomposition
- Dependency editor
- Capacity windows
- Priority scoring
- Weekly plan generation
- Plan versioning and explanations

Release slice:

The system generates an explainable weekly plan containing both current coursework and early major-project work.

## Phase 4: Daily execution and recovery

Epics:

- Today view
- Session start and completion
- Partial completion and remaining effort
- Drag-and-drop Week Map
- Locked blocks
- Disruption reporting
- Minimal-change replanning

Release slice:

A student can follow the plan for a week and recover after a missed day.

## Phase 5: Grades and coach

Epics:

- Manual grade entry
- Screenshot-assisted grade import
- Course-standing estimates
- Coach chat
- Typed coach actions
- Cross-course reallocation explanations

Release slice:

Grades can refine strategy, and the student can ask what to do or how to recover.

## Phase 6: Pilot hardening

Epics:

- Accessibility audit
- Privacy and deletion workflow
- Notification controls
- Telemetry and product metrics
- Performance optimization
- Error recovery
- PWA installability

Release criteria:

- Complete two-course setup from PDFs.
- Generate a feasible plan.
- Complete and miss sessions.
- Replan with a clear diff.
- Enter grades.
- Switch themes.
- Pass agreed accessibility checks.
- No critical privacy or data-loss defects.

## Prioritized MVP backlog

### Must have

- Term and course management
- Syllabus extraction and review
- Assignment and grading weights
- Recurring commitments
- Major-project milestones
- Weekly scheduler
- Today recommendation
- Move, lock, complete, partial, miss
- Replanning
- Plain and Quest themes
- Manual grades

### Should have

- Mission theme
- Grade screenshot import
- Coach chat
- Calendar import
- Notifications
- PWA offline shell

### Could have

- LMS integrations
- Academic coach sharing
- Cosmetic map progression
- Historical effort analytics
- Course templates

## Pilot metrics

- Setup completion rate
- Extraction correction rate
- Suggested block acceptance rate
- Sessions started
- Major-project lead time
- Replan completion time
- Plan churn
- User confidence score
- Self-reported overwhelm before and after planning
