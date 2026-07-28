import { z } from "zod";

/**
 * Typed actions the coach may propose.
 *
 * The coach never writes to academic records. It emits one of these, the UI renders it as
 * a button, and the student's click is what actually calls the API
 * (docs/08-coding-agent-handoff.md §6: "Never let an LLM write directly to confirmed
 * academic records").
 */
export const COACH_ACTION_TYPES = [
  "START_SESSION",
  "RESIZE_SESSION",
  "MOVE_SESSION",
  "SKIP_SESSION",
  "LOCK_SESSION",
  "DECOMPOSE_WORK_ITEM",
  "REPLAN_WEEK",
  "SHOW_WORK_ITEM",
  "SHOW_WEEK",
] as const;

export type CoachActionType = (typeof COACH_ACTION_TYPES)[number];

export const coachAction = z.object({
  type: z.enum(COACH_ACTION_TYPES),
  /** Button text. Short, imperative, plain language. */
  label: z.string().min(1).max(60),
  payload: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type CoachAction = z.infer<typeof coachAction>;

export const coachReply = z.object({
  message: z.string().min(1),
  /** Statements the coach can point to in the plan data it was given. */
  facts: z.array(z.string()).max(5).default([]),
  /** Anything it had to assume. Named explicitly rather than smuggled into the message. */
  assumptions: z.array(z.string()).max(5).default([]),
  actions: z.array(coachAction).max(3).default([]),
});
export type CoachReply = z.infer<typeof coachReply>;

/** JSON Schema handed to the provider so the model is constrained, not just asked nicely. */
export const COACH_REPLY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "facts", "assumptions", "actions"],
  properties: {
    message: { type: "string" },
    facts: { type: "array", items: { type: "string" }, maxItems: 5 },
    assumptions: { type: "array", items: { type: "string" }, maxItems: 5 },
    actions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "label", "payload"],
        properties: {
          type: { type: "string", enum: [...COACH_ACTION_TYPES] },
          label: { type: "string" },
          payload: {
            type: "object",
            additionalProperties: false,
            properties: {
              sessionId: { type: "string" },
              workItemId: { type: "string" },
              minutes: { type: "number" },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Drops any action that references a session or work item the student does not actually
 * have. A hallucinated id would render as a button that fails on click.
 */
export function pruneInvalidActions(
  actions: CoachAction[],
  known: { sessionIds: Set<string>; workItemIds: Set<string> },
): CoachAction[] {
  return actions.filter((action) => {
    const sessionId = action.payload["sessionId"];
    const workItemId = action.payload["workItemId"];
    if (typeof sessionId === "string" && !known.sessionIds.has(sessionId)) return false;
    if (typeof workItemId === "string" && !known.workItemIds.has(workItemId)) return false;

    // These action types are meaningless without a target.
    const needsSession: CoachActionType[] = [
      "START_SESSION",
      "RESIZE_SESSION",
      "MOVE_SESSION",
      "SKIP_SESSION",
      "LOCK_SESSION",
    ];
    if (needsSession.includes(action.type) && typeof sessionId !== "string") return false;
    if (action.type === "DECOMPOSE_WORK_ITEM" && typeof workItemId !== "string") return false;

    return true;
  });
}
