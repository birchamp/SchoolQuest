# Product Brief: QuestMap

## 1. Product vision

QuestMap helps college students confidently act on the right academic work at the right time. It combines syllabus intelligence, long-project planning, weekly time-boxing, adaptive prioritization, and optional game-inspired presentation.

The system should reduce two forms of anxiety at once:

- **Immediate uncertainty:** “What should I work on now?”
- **Future uncertainty:** “If I focus on this, will the other work still get done?”

## 2. Problem

Traditional calendars show when events occur. Task managers list what remains. Learning-management systems show what instructors have posted. None reliably turn the whole semester into a realistic, continuously adjusted work plan.

Students with ADHD, autism-spectrum traits, time blindness, weak task initiation, or difficulty shifting plans may experience:

- Major papers and exams becoming urgent before meaningful preparation begins.
- Low-value work consuming high-quality focus time.
- Overwhelm when every task is presented with equal visual weight.
- Difficulty recovering after a missed day or changed work schedule.
- Avoidance of grades, assignment portals, or planning because they feel punitive.
- Lack of confidence that hidden or future work is being protected.

## 3. Target user

### Primary persona: Strategy-capable but execution-overloaded student

The student can understand complex rule systems and make sophisticated strategic decisions when information is structured meaningfully. Academic planning is harder because information is fragmented, priorities are implicit, and consequences unfold over weeks.

Needs:

- A clear weekly map.
- One recommended next action.
- Evidence that future obligations are accounted for.
- Flexible replanning without shame.
- Project steps that reveal prerequisites early.
- Meaningful strategy rather than arbitrary streaks or badges.

### Secondary users

- Academic coaches or parents, only with explicit student permission.
- Students who prefer a plain productivity interface.
- Disability-support staff recommending planning tools.

## 4. Value proposition

QuestMap transforms course documents and life commitments into an adaptive semester strategy. It balances recurring coursework with high-impact long-term assignments, gives the student an explainable recommendation for what to do next, and replans calmly when reality changes.

## 5. Product principles

1. **Trust before motivation.** The student must believe the system is protecting all important work.
2. **Strategy, not decoration.** Gamification should clarify tradeoffs, prerequisites, progress, and consequences.
3. **One manageable horizon.** Show the present clearly; reveal the future without making it visually dominant.
4. **Explain recommendations.** Every priority suggestion should answer “why this now?”
5. **Plan with uncertainty.** Missing grades, ambiguous syllabus dates, and instructor changes are normal states.
6. **Recovery without punishment.** A missed block triggers replanning, not lost lives, red warnings, or guilt.
7. **Student agency.** The student can move, reject, shorten, defer, or lock suggested blocks.
8. **Accessible by default.** Low cognitive load, keyboard support, calm motion, readable contrast, and plain-language alternatives.
9. **Theme is presentation.** Domain records remain courses, assignments, milestones, work sessions, and grades.
10. **Protect personal data.** Academic records and uploaded syllabi are sensitive.

## 6. Core experience

### Semester setup

The student:

1. Creates a term.
2. Adds class meeting times and recurring commitments.
3. Uploads a syllabus PDF for each course.
4. Reviews extracted assignments, grading weights, policies, and dates.
5. Answers only unresolved setup questions.
6. Sets availability, preferred work duration, energy patterns, and theme.
7. Reviews a proposed first-week plan.

### Weekly loop

1. QuestMap recalculates the upcoming week.
2. The Week Map shows fixed events, recommended work blocks, major-project progress, and protected future capacity.
3. The Today view recommends one next action and explains it.
4. The student starts, changes, or skips the session.
5. Completion and effort update the plan.
6. New grades or changed deadlines revise priorities.

### Disruption loop

The student can say or select:

- “I lost today.”
- “My work shift changed.”
- “This took longer than expected.”
- “The professor moved the deadline.”
- “I cannot work on this right now.”

The app proposes a revised plan, shows what moved and why, and asks for confirmation when a meaningful tradeoff is required.

## 7. Game model

QuestMap may use a tabletop-inspired metaphor:

- Semester = campaign
- Course = region or questline
- Major assignment/exam = major quest
- Milestone = quest stage
- Work session = action or encounter
- Prerequisite artifact = required item/resource
- Grade result = outcome/intelligence, not personal worth
- Today recommendation = next move
- Future work = visible through a “fog of future,” not hidden

The user may switch to Mission or Plain terminology at any time.

## 8. MVP scope

### In scope

- Account and local profile.
- Term, course, and recurring schedule setup.
- Syllabus PDF upload and AI-assisted extraction.
- Assignment review and correction.
- Major-project decomposition into editable milestones.
- Weekly availability and time-box generation.
- Today recommendation with rationale.
- Drag-and-drop scheduling and quick disruption reporting.
- Completion, skip, partial completion, and effort feedback.
- Manual grade entry and screenshot-assisted grade extraction.
- Quest, Mission, and Plain terminology themes.
- Basic progress and risk indicators.

### Out of scope for MVP

- Automatic Canvas/Blackboard/Brightspace integration.
- Messaging instructors.
- Social competition or public leaderboards.
- Clinical diagnosis or treatment advice.
- Fully autonomous schedule changes without user visibility.
- Parent surveillance.
- Native mobile apps; responsive web/PWA is sufficient initially.

## 9. Success measures

### Activation

- At least 70% of testers finish one course setup after uploading a syllabus.
- Median setup correction time under 10 minutes per course.

### Planning usefulness

- At least 70% of generated work blocks are accepted or moved rather than deleted.
- Students report confidence that major projects are accounted for.
- Major projects receive at least one completed work session seven or more days before deadline.

### Daily usefulness

- At least 50% of active days include opening Today or Week Map.
- Recommended next action starts within two interactions.

### Recovery

- A missed day can be replanned in under one minute.
- Users describe replanning language as neutral or encouraging, not punitive.

### Safety and quality

- No extracted deadline is treated as confirmed without source evidence or user confirmation.
- No grade screenshot is retained longer than needed unless the user explicitly saves it.
