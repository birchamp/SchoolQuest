# UX and Interaction Specification

## 1. Experience goals

The interface should feel like a calm strategy map, not an arcade game and not a corporate calendar. It should communicate:

- The system sees the whole semester.
- The student only needs to choose the next manageable move.
- Important future work is protected.
- Plans are allowed to change.

## 2. Information architecture

Primary navigation:

1. **Today** - next action and immediate schedule.
2. **Week Map** - time boxes and weekly strategy.
3. **Campaign / Semester** - courses, major projects, and future horizon.
4. **Inbox** - items needing confirmation, changed dates, missing information, and extracted grades.
5. **Coach** - conversational planning assistance.
6. **Settings** - availability, themes, notifications, privacy, and integrations.

## 3. Visual metaphor

### Map layers

- **Foreground:** today and current week, high contrast and precise.
- **Middle distance:** next two to four weeks, recognizable but visually quieter.
- **Far horizon:** later semester obligations represented as landmarks, counts, or faint paths.

The future must not be literally hidden. The user should be able to inspect it at any time.

### Status vocabulary

Underlying status | Quest theme | Mission theme | Plain theme
---|---|---|---
Assignment | Quest | Assignment | Assignment
Major assignment | Major quest | Major operation | Major project
Milestone | Stage | Objective | Step
Work session | Action | Work block | Work block
Dependency | Required item | Prerequisite | Prerequisite
Recommended next action | Next move | Priority action | Recommended task
Term | Campaign | Term | Semester

## 4. Onboarding flow

### Screen 1: Promise

Headline: “Know what to do now without losing sight of what comes next.”

Actions:

- Start a semester
- View a sample

### Screen 2: Choose presentation

Cards:

- Quest: strategic map, quests, stages, resources
- Mission: objectives, operations, readiness
- Plain: courses, projects, work blocks

Copy makes clear that this can change later.

### Screen 3: Add fixed commitments

The student can:

- Add class meetings
- Add work schedule
- Import a calendar later
- Skip and complete during course setup

### Screen 4: Upload first syllabus

PDF drop zone plus privacy note.

### Screen 5: Extraction review

Split-screen layout:

- Left: PDF page viewer with source highlights.
- Right: extracted course facts and assignment rows.

Statuses:

- Confirmed-looking
- Needs review
- Missing

The app should avoid a giant form. Review is grouped into short passes:

1. Course and meeting information
2. Grading structure
3. Assignment dates
4. Major projects

### Screen 6: Planning preferences

Use simple ranges and examples:

- Typical focus session: 25 / 45 / 60 / 90 minutes
- Best focus times
- Maximum schoolwork on class days
- Protected times
- Preferred amount of buffer

### Screen 7: First plan

Show only the first seven days, plus a “Future work protected” panel listing the next major project milestones.

## 5. Today screen

### Primary card

Contains:

- Course badge
- Action title
- Suggested duration
- Project stage context
- Why now
- Start button

Example:

> **Find three psychology sources - 45 min**  
> This is the first required item for your 250-point paper. Today has your best library-sized focus block, and the paper draft begins next week.

Secondary actions:

- I only have 20 minutes
- Not now
- Move it
- Break it down

### Confidence panel

A small expandable panel titled “What is already covered?” shows:

- Reading scheduled Thursday
- Education quiz review scheduled Friday
- Paper outline protected for Sunday

This is essential to the product's trust promise.

### Day timeline

A compact timeline includes fixed events and planned blocks. It should not dominate the screen.

## 6. Week Map

### Layout

Desktop:

- Main seven-day calendar grid
- Collapsible strategy rail on the right
- Course/project lanes above or below the grid

Mobile:

- Day strip with swipe navigation
- Agenda list
- Strategy drawer

### Work block anatomy

A work block shows:

- Course marker
- Short action title
- Duration
- Flexibility icon
- Major-project indicator

On focus/hover:

- Reason for placement
- Deadline
- Value or weight
- Dependency context
- Move and lock controls

### Drag behavior

When dragging:

- Valid destinations highlight.
- Conflicts are visible.
- A consequence label appears, such as “safe,” “uses buffer,” or “creates risk.”
- Dropping a high-impact block into a poor position opens a confirmation sheet rather than blocking the user.

### Strategy rail

Sections:

- This week's priorities
- Capacity
- Major project progress
- Unscheduled or uncertain work
- Changes since last plan

## 7. Major project path

Display as a horizontal or vertical path of stages.

Each stage includes:

- Name
- Target window
- Estimated effort
- Status
- Dependency
- Scheduled sessions

The complete project remains visible, but distant stages use less visual emphasis.

Actions:

- Add stage
- Combine stages
- Make simpler
- Change estimate
- Mark prerequisite obtained
- Ask coach

## 8. Inbox

The Inbox prevents uncertain data from silently affecting the plan.

Item types:

- Confirm extracted due date
- Grade detected from screenshot
- Instructor changed an assignment
- Course has no grading weights
- Session took much longer than expected
- Plan contains unscheduled required work

Each item must support a clear resolution or “leave unknown.”

## 9. Coach interaction

The Coach may be a drawer or full page. It should use action cards inside the conversation.

Example response:

> Your psychology paper is worth 250 points and needs library sources before drafting. Your education reading is due sooner, but it can fit in a lower-energy block tomorrow. I recommend using the next 45 minutes for sources.

Actions:

- Put it on my plan
- Give me a 20-minute version
- Show the tradeoff
- Choose something else

## 10. Replanning interaction

Quick disruption button options:

- Lost time today
- Shift changed
- Deadline changed
- Work took longer
- Too overwhelmed
- Something else

Replan review shows a concise diff:

- Moved psychology reading to Thursday dinner
- Shortened education review from 45 to 25 minutes
- Protected paper sources Tuesday
- Paper outline now has one day less buffer

Use neutral copy: “Here is the best recovery plan I found.”

## 11. Game mechanics

### Recommended mechanics

- Project paths and prerequisite items
- Strategic value indicators
- Progress through meaningful stages
- Capacity as a limited resource
- “Next move” recommendations
- Optional earned cosmetic map elements

### Avoid

- Punishing missed streaks
- Random loot tied to academic compliance
- Public comparison
- Grade-based character worth
- Excessive animations
- Red danger states for ordinary uncertainty
- Invented RPG complexity that makes planning harder

## 12. Accessibility and neurodivergent design

- Default to a low-information Today view.
- Preserve a predictable location for primary actions.
- Let users disable decorative game elements.
- Use literal labels in tooltips and screen-reader text.
- Offer “reduce choices” and “show full detail” modes.
- Provide externalized time with timers and visible session endpoints.
- Never rely on “just remember to check.”
- Allow the user to snooze a decision without losing it.
- Avoid modal chains.
- Support undo for scheduling actions.
