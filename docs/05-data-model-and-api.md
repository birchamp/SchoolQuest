# Data Model and API Specification

## 1. Design principles

- Domain terminology is theme-neutral.
- AI extraction claims are stored separately from confirmed records.
- Plans are versioned and auditable.
- User overrides are first-class data.
- Unknown values remain unknown rather than receiving fake defaults.

## 2. Core entities

### User

- `id`
- `email`
- `display_name`
- `timezone`
- `theme`: `quest | mission | plain`
- `reduced_motion`
- `detail_mode`: `reduced | standard | expanded`
- `created_at`

### Term

- `id`
- `user_id`
- `name`
- `start_date`
- `end_date`
- `status`
- `planning_preferences_json`

### Course

- `id`
- `term_id`
- `name`
- `code`
- `instructor`
- `credits`
- `color_token`
- `expected_weekly_minutes`
- `target_grade`
- `grading_confidence`

### SourceDocument

- `id`
- `course_id`
- `type`
- `storage_key`
- `filename`
- `mime_type`
- `sha256`
- `processing_status`
- `uploaded_at`

### ExtractionClaim

- `id`
- `source_document_id`
- `claim_type`
- `payload_json`
- `page_number`
- `source_excerpt`
- `bounding_box_json`
- `confidence`
- `review_status`
- `resolved_entity_type`
- `resolved_entity_id`

### MeetingPattern

- `id`
- `course_id`
- `days_of_week`
- `start_time`
- `end_time`
- `location`
- `effective_start`
- `effective_end`

### Commitment

- `id`
- `term_id`
- `title`
- `commitment_type`
- `start_at`
- `end_at`
- `recurrence_rule`
- `flexibility`
- `locked`

### GradingCategory

- `id`
- `course_id`
- `name`
- `weight_percent`
- `drop_rule_json`
- `confidence_status`

### WorkItem

- `id`
- `course_id`
- `parent_work_item_id`
- `title`
- `description`
- `work_type`
- `available_at`
- `due_at` -- a full instant, not a day. The time of day is the deadline the planner schedules
  against; end of day (`23:59`) is what a syllabus stating only a date means, and the assignments
  table can set any other hour.
- `points_possible`
- `grading_category_id`
- `category_share_percent`
- `estimated_minutes`
- `remaining_minutes`
- `cognitive_demand`
- `divisibility`
- `location_requirement`
- `status`
- `source_confidence`
- `user_priority`

### Dependency

- `id`
- `predecessor_work_item_id`
- `successor_work_item_id`
- `dependency_type`

### WorkSession

- `id`
- `work_item_id`
- `plan_version_id`
- `start_at`
- `end_at`
- `status`
- `placement_status`
- `locked`
- `accepted_by_user`
- `actual_minutes`
- `outcome_code`

### GradeResult

- `id`
- `work_item_id`
- `points_earned`
- `points_possible`
- `letter_grade`
- `posted_at`
- `confirmation_status`
- `source_document_id`

### PlanVersion

- `id`
- `term_id`
- `version_number`
- `horizon_start`
- `horizon_end`
- `generation_reason`
- `algorithm_version`
- `status`
- `summary_json`
- `created_at`

### Recommendation

- `id`
- `plan_version_id`
- `work_session_id`
- `rank`
- `reason_codes`
- `tradeoff_json`
- `expires_at`

### AvailabilityRule

- `id`
- `term_id`
- `day_of_week`
- `start_time`
- `end_time`
- `energy_level`
- `location`
- `hardness`

### AuditEvent

- `id`
- `user_id`
- `entity_type`
- `entity_id`
- `action`
- `before_json`
- `after_json`
- `actor_type`
- `created_at`

## 3. Important enums

### WorkItem status

- `unconfirmed`
- `not_started`
- `in_progress`
- `blocked`
- `completed`
- `submitted`
- `canceled`
- `optional`

### WorkSession status

- `planned`
- `started`
- `completed`
- `partial`
- `missed`
- `skipped`
- `moved`

### Confidence status

- `confirmed`
- `high_inference`
- `low_inference`
- `unknown`
- `superseded`

## 4. API surface

### Terms

- `POST /api/terms`
- `GET /api/terms/:id`
- `PATCH /api/terms/:id`
- `POST /api/terms/:id/archive`

### Courses and syllabi

- `POST /api/terms/:termId/courses`
- `PATCH /api/courses/:id`
- `POST /api/courses/:id/documents`
- `GET /api/documents/:id/extraction`
- `POST /api/documents/:id/extraction/confirm`

### Work items

- `GET /api/terms/:termId/work-items`
- `POST /api/courses/:courseId/work-items`
- `PATCH /api/work-items/:id`
- `DELETE /api/work-items/:id` -- removes the item, its stages, its blocks and its result.
  Distinct from `PATCH { status: "canceled" }`, which keeps the record and only takes the work
  out of the plan.
- `POST /api/work-items/:id/decompose`
- `POST /api/work-items/:id/dependencies`

### Commitments and availability

- `POST /api/terms/:termId/commitments`
- `PATCH /api/commitments/:id`
- `POST /api/terms/:termId/availability-rules`

### Plans

- `POST /api/terms/:termId/plans/generate`
- `GET /api/terms/:termId/plans/current`
- `POST /api/plans/:id/accept`
- `POST /api/plans/:id/replan`
- `GET /api/plans/:id/diff/:otherPlanId`

### Sessions

- `PATCH /api/work-sessions/:id`
- `POST /api/work-sessions/:id/start`
- `POST /api/work-sessions/:id/complete`
- `POST /api/work-sessions/:id/move`
- `POST /api/work-sessions/:id/lock`

### Grades

- `POST /api/work-items/:id/grades`
- `POST /api/courses/:id/grade-screenshots`
- `POST /api/grade-imports/:id/confirm`

### Coach

- `POST /api/coach/messages`
- `POST /api/coach/actions/:actionId/execute`

## 5. Example plan-generation request

```json
{
  "horizon_start": "2026-09-07",
  "horizon_days": 7,
  "reason": "weekly_refresh",
  "preserve_accepted_sessions": true
}
```

## 6. Example recommendation response

```json
{
  "primary": {
    "session_id": "ws_123",
    "work_item_id": "wi_sources",
    "title": "Find three psychology sources",
    "duration_minutes": 45,
    "reason_codes": [
      "UNLOCKS_MAJOR_PROJECT",
      "HIGH_ACADEMIC_VALUE",
      "BEST_CONTEXT_WINDOW"
    ],
    "explanation": "This unlocks the outline for a high-value paper and fits your strongest library-compatible window."
  },
  "alternatives": [],
  "protected_later": [
    "Education reading on Thursday",
    "Psychology outline on Sunday"
  ]
}
```

## 7. Plan versioning

Never mutate an accepted plan beyond individual explicit user edits. Replanning creates a new PlanVersion and a diff. Completed sessions may be referenced by later plans but are immutable historical records.

## 8. Deletion and privacy

- Deleting a document removes the stored file and extraction claims.
- Confirmed academic records derived from the document may be retained only after informing the user.
- Deleting an account removes all terms, documents, screenshots, plans, and chat content according to a documented retention process.
