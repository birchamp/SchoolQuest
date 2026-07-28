# Planning Engine Specification

## 1. Purpose

The planning engine converts assignments, milestones, deadlines, values, estimated effort, constraints, preferences, and outcomes into feasible work sessions. It must be deterministic enough to test, explainable enough to trust, and flexible enough to recover from disruptions.

## 2. Planning objects

- **Fixed block:** class, work, appointment, sleep, commute, or locked session.
- **Flexible commitment:** meal, exercise, or movable routine.
- **Work item:** assignment, reading, quiz preparation, project milestone, or exam preparation.
- **Work session:** scheduled portion of a work item.
- **Dependency:** work item or resource that must be completed before another item.
- **Capacity window:** available time with energy, location, and interruption attributes.
- **Buffer:** intentionally unused capacity before a deadline.

## 3. Planning horizons

- **Now:** current day; high precision.
- **Operational horizon:** next seven days; concrete time boxes.
- **Tactical horizon:** next four weeks; milestone windows and reserved capacity.
- **Strategic horizon:** remainder of semester; workload forecast and major landmarks.

Only the operational horizon requires exact session placement. Later horizons may reserve capacity without assigning exact times.

## 4. Work-item classification

Suggested types and default decomposition behavior:

- Reading: divisible; lower switching cost; location-flexible.
- Quiz preparation: divisible; should include retrieval practice near quiz.
- Problem set: divisible, but may require contiguous sessions.
- Paper: multi-stage with research and revision dependencies.
- Presentation: multi-stage with content, slides, rehearsal, and delivery.
- Group project: multi-stage with external dependencies and coordination risk.
- Exam: distributed study sessions with spacing.
- Lab: fixed or semi-fixed, may require pre-lab and report stages.

## 5. Priority model

A work item's scheduling priority should not be a single opaque AI judgment. Use a weighted, inspectable score.

Example normalized components from 0 to 1:

- `deadline_pressure`: increases as slack decreases.
- `academic_value`: based on points, course weighting, and expected grade impact.
- `project_leverage`: early steps that unlock later work.
- `failure_risk`: uncertainty, complexity, prior underestimation, or weak course standing.
- `spacing_need`: benefit from distributed work, especially exams.
- `context_fit`: match between task needs and available window.
- `neglect_penalty`: time since meaningful progress.
- `user_priority`: explicit student preference.
- `confidence_penalty`: reduces aggressive scheduling when data is uncertain.

Illustrative score:

```
priority =
  0.24 * deadline_pressure +
  0.20 * academic_value +
  0.16 * project_leverage +
  0.14 * failure_risk +
  0.08 * spacing_need +
  0.08 * context_fit +
  0.05 * neglect_penalty +
  0.05 * user_priority
```

Weights must be configurable and validated with real users. The score ranks candidate placements; it does not override hard constraints.

## 6. Academic value

Where possible, estimate value from:

- Assignment points divided by total known course points.
- Grading-category weight multiplied by assignment share within category.
- Instructor-provided percentage.
- Major-project status when precise value is unavailable.

Do not compare raw points across courses without normalization. A 50-point assignment in one course may matter more than a 200-point assignment in another.

When grading structure is incomplete, display a qualitative confidence level.

## 7. Course standing adjustment

If sufficient confirmed grades exist, calculate a course-risk factor.

Potential inputs:

- Current estimated course grade
- Remaining recoverable weight
- Trend
- Missing or overdue work
- User-stated target grade

Rules:

- Pending grades are unknown, not zero.
- A low grade may increase attention, but not at the expense of mathematically unrecoverable or already-secure courses without explanation.
- The system should state, “Psychology currently has higher improvement potential,” rather than “You are bad at psychology.”

## 8. Project decomposition

### Input

- Assignment prompt and rubric
- Due date
- Available date
- Submission type
- Estimated total effort
- User experience and preferences
- Known intermediate deadlines

### Output

An editable directed acyclic graph of milestones.

Each milestone includes:

- Earliest start
- Preferred completion window
- Latest safe completion
- Duration estimate
- Cognitive demand
- Location/resource requirements
- Dependencies
- Deliverable evidence

### Scheduling backward from deadline

1. Reserve submission buffer.
2. Place final review before buffer.
3. Place full draft or practice performance before review.
4. Place production stages before draft.
5. Place prerequisites, such as source gathering, early enough to avoid blocking.
6. Spread work according to task type and available capacity.

## 9. Effort estimation

Sources, in descending preference:

1. User's historical time for similar work.
2. User-provided estimate.
3. Course-specific historical average.
4. Generic type-based estimate.
5. AI estimate from prompt complexity.

Store both original and updated estimates. After sessions, update remaining effort using a bounded learning rate to avoid wild swings.

## 10. Capacity-window scoring

Each available window has:

- Start/end
- Duration
- Energy level
- Location
- Device/resources
- Proximity to class or work
- Interruption likelihood

Candidate task fit considers:

- Required duration and divisibility
- Cognitive demand versus energy
- Context requirements
- Deadline urgency
- Switching cost
- User preferences

Example: source research fits a library window; light reading may fit a meal or low-energy evening only if the user allows it.

## 11. Plan generation algorithm

Recommended initial approach: constraint-aware heuristic scheduler, not a fully generative LLM scheduler.

1. Validate input data and identify unresolved critical uncertainty.
2. Expand major projects into active milestones.
3. Calculate required sessions and safe windows.
4. Place fixed and locked blocks.
5. Reserve hard buffers for high-impact deadlines.
6. Generate candidate placements for required sessions.
7. Sort sessions by priority and placement scarcity.
8. Choose the highest-utility feasible placement.
9. Run conflict and overload checks.
10. Improve the schedule through local swaps.
11. Produce explanations and list unscheduled work.

A constraint solver may be introduced later, but explanations and user overrides remain mandatory.

## 12. Stable planning

Frequent total schedule churn destroys trust. Recalculation should include a movement cost.

- Locked blocks never move automatically.
- Accepted blocks have high movement cost.
- Tentative blocks have moderate movement cost.
- Future capacity reservations have low movement cost.

Prefer changing the minimum number of blocks needed to restore feasibility.

## 13. Replanning events

Triggers:

- Deadline changed
- Assignment added or removed
- Fixed commitment changed
- Session missed
- Session duration differs substantially
- Grade changes course risk
- User changes target or preference

Replanning process:

1. Freeze completed and in-progress work.
2. Preserve locked and near-term accepted blocks where feasible.
3. Update remaining effort and constraints.
4. Calculate affected work only.
5. Generate smallest safe change set.
6. Present meaningful tradeoffs.

## 14. Confidence and uncertainty

Every planning input should have a status:

- Confirmed
- Inferred with high confidence
- Inferred with low confidence
- Unknown
- Superseded

Planning behavior:

- Low-confidence due dates create reminders to confirm and conservative buffers.
- Unknown point value uses type and course structure rather than pretending precision.
- Unknown grade does not reduce or inflate course standing.

## 15. Explanations

The engine returns structured reason codes, later rendered in theme language.

Example:

```json
{
  "recommendation": "session_123",
  "reason_codes": [
    "UNLOCKS_MAJOR_PROJECT",
    "HIGH_ACADEMIC_VALUE",
    "BEST_CONTEXT_WINDOW",
    "PRESERVES_DEADLINE_BUFFER"
  ],
  "tradeoff": "READING_MOVED_TO_LOW_ENERGY_WINDOW"
}
```

Plain explanation:

> Find sources now because this step unlocks the paper outline, the paper has high course value, and this is your strongest library-compatible window.

## 16. Risk indicators

- **Safe:** enough estimated capacity and buffer.
- **Watch:** feasible but buffer is thin or input is uncertain.
- **At risk:** required effort exceeds likely capacity or a prerequisite is late.
- **Decision needed:** no feasible plan without changing a constraint or priority.

Avoid catastrophic visual language.

## 17. Testing

Unit tests should cover:

- Pending grades not treated as zero.
- Raw points normalized within courses.
- Prerequisites placed before dependent work.
- Locked blocks preserved.
- Missed sessions add remaining effort.
- A changed deadline affects only relevant plan areas.
- No session scheduled outside availability.
- Daily maximum respected.
- Stable inputs yield stable schedules.
- Every recommendation includes reason codes.

Scenario tests should include:

- Two quizzes this week plus a large paper due in three weeks.
- A work shift added after the plan is accepted.
- A paper deadline moved earlier.
- Three unknown grades and one confirmed low grade.
- A missed day with insufficient remaining capacity.
- A project whose first step requires a library visit.
