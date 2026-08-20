import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";
import type { Term } from "../lib/types";

/**
 * The way back from "start a new semester".
 *
 * Archiving a term never deleted it -- courses, syllabi and grades are all still there behind a
 * status flag -- but nothing let a student reopen one, so an archive made by accident looked like
 * a loss. This lists the archived terms and reopens the chosen one, which becomes active again
 * (the current active term is archived in its place). Renders nothing when there is nothing
 * archived, so it can sit on both onboarding and Setup and simply disappear when it is not needed.
 */
function range(startDate: string, endDate: string): string {
  const fmt = (d: string) =>
    new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(startDate)} - ${fmt(endDate)}`;
}

export function ArchivedTerms({ onReopened }: { onReopened: () => void | Promise<void> }) {
  const quest = useBodyTheme() === "quest";
  const [archived, setArchived] = useState<Term[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { terms } = await api.get<{ terms: Term[] }>("/api/terms");
      setArchived(terms.filter((t) => t.status === "archived"));
    } catch {
      setArchived([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reopen(term: Term) {
    setBusy(term.id);
    setError(null);
    try {
      await api.post(`/api/terms/${term.id}/unarchive`);
      await onReopened();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      setBusy(null);
    }
  }

  if (archived.length === 0) return null;

  return (
    <section className="card" aria-labelledby="archived-terms-heading">
      <h2 id="archived-terms-heading">{quest ? "Past campaigns" : "Archived semesters"}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Nothing here was deleted. Reopen one to make it the active semester again -- the current one
        is archived in its place, and can be reopened the same way.
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="alternatives">
        {archived.map((term) => (
          <li key={term.id}>
            <span>
              {term.name}
              <span className="muted"> &middot; {range(term.startDate, term.endDate)}</span>
            </span>
            <button className="action" disabled={busy !== null} onClick={() => void reopen(term)}>
              {busy === term.id ? "Reopening…" : "Reopen"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
