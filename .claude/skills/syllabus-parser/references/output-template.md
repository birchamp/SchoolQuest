# Standardized syllabus output template

Use this exact section order. Omit a section only when the original genuinely contains
nothing for it, and say so in the Changes & Corrections note rather than dropping it
silently. Everything from "Original Document" down is verbatim source, not your writing.

Confidence markers, used throughout:

- *(stated)* -- printed in the original for this exact item
- *(derived)* -- computed by arithmetic from stated facts; the basis is given
- *(inferred)* -- required a judgment call; the call is described
- **[?]** -- unresolved; listed under Open Questions

Flag anything corrected or suspicious inline with a footnote-style marker (`[C1]`, `[Q2]`)
pointing into Changes & Corrections or Open Questions, so the schedule stays scannable.

**Source links are embedded throughout, not gathered at the bottom.** Every extracted
fact links to the place in the appended original it came from, so one click jumps from a
claim to the text supporting it. The mechanics:

- Each page (or section, for an unpaginated original) of the appended original gets its
  own heading: `### Original -- Page 5`. Markdown renderers turn that into the anchor
  `#original----page-5` on GitHub, but slug rules vary -- write the anchors explicitly
  where the renderer supports it, or keep headings short and test one link. A safe
  portable pattern is an HTML anchor beside the heading:
  `### Original -- Page 5 <a id="orig-p5"></a>` linked as `[p.5](#orig-p5)`.
- In the generated sections, cite with a compact link at the end of the fact:
  a table cell gets `[p.5](#orig-p5)`, a prose line gets `([p.3](#orig-p3))`. The
  schedule table carries a dedicated `Source` column so every row is one click from its
  evidence.
- If the original lives at a URL (or a file path), link each anchor heading back to it --
  to the exact page where the format allows (`https://.../syllabus.pdf#page=5`) -- so the
  chain runs claim -> appended text -> real document.

---

```markdown
# {COURSE CODE}: {Course Title}
## Standardized Syllabus -- {Term} {Year}

> Regenerated from "{original filename or title}" on {date}. This is a structured reading
> of the original syllabus, which is included in full at the bottom of this document.
> Items marked [?] are unresolved; see Open Questions. Corrections are listed in
> Changes & Corrections.

## 1. Course Information

| | | Source |
| --- | --- | --- |
| Course | {code and title} | [p.1](#orig-p1) |
| Instructor | {name, title} | [p.1](#orig-p1) |
| Contact | {email / office / office hours} | [p.1](#orig-p1) |
| Meets | {days, times, location} | [p.1](#orig-p1) |
| Term | {first day of instruction} to {last day of instruction} | [p.1](#orig-p1) |
| Finals window | {dates, if known} | [p.6](#orig-p6) |
| Breaks | {each break/holiday, by date} | [p.6](#orig-p6) |
| Prerequisites | {or "none stated"} | [p.2](#orig-p2) |
| Materials | {required texts and resources, condensed} | [p.3](#orig-p3) |

## 2. Course Description & Objectives

{One short paragraph of description; objectives as a compact list. Condense freely --
this section is reference, not the deliverable.}

## 3. Grading

| Category | Weight | Count | Notes | Source |
| --- | --- | --- | --- | --- |
| {e.g. Quizzes} | {30%} | {13 (derived: one per instructional week from week 2)} | {cumulative; lowest dropped} | [p.4](#orig-p4) |
| ... | | | | |
| **Total** | **{sum}** | | {call out plainly if not 100} | |

{If the course grades in points, show points and derived shares, and say so:
"This course is graded out of 100 points rather than percentages."}

{Grading scale table if the original provides one.}

## 4. Course Policies

{Every policy with a grade consequence, each as one bold-led line ending in its source
link:}
- **Attendance cliff:** {e.g. "More than 7 absences (excused or unexcused) fails the
  course." (stated)} ([p.3](#orig-p3))
- **Late work:** {...} ([p.4](#orig-p4))
- **Academic integrity:** {...} ([p.4](#orig-p4))

## 5. Assignments & Assessments

{One short subsection per category: what the work is, requirements (length, format,
rubric), and how it was dated. This is where the two descriptions of each assignment --
schedule row and grading paragraph -- appear merged, with a source link for *each* of the
merged descriptions, e.g. "... a 10-page research paper ([p.4](#orig-p4)) due December 4
([p.6](#orig-p6))".}

## 6. Comprehensive Chronological Schedule

{Every dated item in strict date order: class meetings/topics, readings, every quiz and
exam and paper, every expanded instance of recurring work, breaks, and the finals window.
Undated items go at the bottom of the table, not omitted.}

| Date | Week | Item | Type | Worth | Topic / Reading / Notes | Confidence | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mon Aug 25 | 1 | First class | class | -- | Intro; Ch. 1 | stated | [p.5](#orig-p5) |
| Wed Sep 2 | 2 | Quiz 1 | quiz | ~2.3% | Ch. 1-3 (cumulative) | derived [C1] | [p.5](#orig-p5) |
| ... | | | | | | | |
| Nov 24-27 | -- | Thanksgiving Break -- no class | break | -- | | stated | [p.6](#orig-p6) |
| Mon Dec 14 | finals | Final Exam [Q1] | exam | 20% | Registrar sets exact day; first day of window used | derived | [p.6](#orig-p6) |
| -- (undated) | -- | Exam 2 [Q2] | exam | 15% | "Date will be announced on the course portal" | unresolved | [p.4](#orig-p4) |

{"Worth" = the item's share of the final grade where computable (category weight divided
by count), marked ~ when derived.}

## 7. Open Questions

**Resolved during parsing** (answers the user gave, recorded so the reading is auditable):
- {question -> answer}

**For your instructor** (phrased to forward verbatim):
- [Q1] {e.g. "The syllabus says the final is during finals week, Dec 14-18. Has the
  registrar published the exact day?"}
- [Q2] {...}

## 8. Changes & Corrections

- [C1] {e.g. "Quizzes are listed by week range; you confirmed they fall on Wednesdays.
  All 13 quiz dates are derived from that answer."}
- {e.g. "The original dates the mid-term 'October 31, 2025' -- a stale year; corrected to
  2026 per your confirmation."}
- {e.g. "Weights sum to 90% as printed; the missing 10% is unaccounted for -- see [Q3]."}

---
---

# Original Document

**Source:** {link to the original file, or its filename/path if no link exists}

{The complete original text, verbatim and untouched, split under one anchored heading per
page (or per section for an unpaginated original). These anchors are what every inline
source link above points at; the heading itself links out to the real document where a
URL exists.}

### [Original -- Page 1](https://example.edu/syllabus.pdf#page=1) <a id="orig-p1"></a>

{verbatim page 1 text}

### [Original -- Page 2](https://example.edu/syllabus.pdf#page=2) <a id="orig-p2"></a>

{verbatim page 2 text}

{...and so on through the last page.}
```
