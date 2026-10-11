import type { PassFail } from "@schoolquest/domain";
import { api } from "../lib/api";

/** Records a Pass/Fail outcome in place of a score, for work that is not marked in points. */
export function recordPassFail(workItemId: string, passFail: PassFail): Promise<unknown> {
  return api.put(`/api/work-items/${workItemId}/grade`, { passFail });
}

/**
 * The Pass and Fail buttons that sit beside a score box. Not everything is marked in points, and
 * Pass/Fail is a result too: it stops the row waiting on a number without moving the percentage.
 *
 * Shared by the work table and the dashboard so the two cannot drift; each owns what happens
 * around the save (busy state, errors, clearing its score box) through `onRecord`.
 */
export function PassFailButtons({
  disabled,
  onRecord,
}: {
  disabled: boolean;
  onRecord: (passFail: PassFail) => void;
}) {
  return (
    <>
      <button
        className="action"
        type="button"
        disabled={disabled}
        onClick={() => onRecord("pass")}
        title="Marked Pass/Fail rather than scored: record a pass"
      >
        Pass
      </button>
      <button
        className="action"
        type="button"
        disabled={disabled}
        onClick={() => onRecord("fail")}
        title="Marked Pass/Fail rather than scored: record a fail"
      >
        Fail
      </button>
    </>
  );
}
