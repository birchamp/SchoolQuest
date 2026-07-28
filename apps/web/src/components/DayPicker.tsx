const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Day-of-week multi-select used by availability, course meetings, and commitments.
 * Buttons rather than checkboxes: tap targets stay usable on the phone PWA, and the
 * selected state is visible without reading fine print.
 */
export function DayPicker({
  value,
  onChange,
  label,
}: {
  value: Set<number>;
  onChange: (days: Set<number>) => void;
  label: string;
}) {
  function toggle(day: number) {
    const next = new Set(value);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange(next);
  }

  return (
    <fieldset style={{ border: 0, padding: 0, margin: "0 0 0.75rem" }}>
      <legend className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.35rem" }}>
        {label}
      </legend>
      <div className="button-row" role="group" aria-label={label}>
        {DAY_LABELS.map((name, day) => (
          <button
            key={name}
            type="button"
            className={`action${value.has(day) ? " primary" : ""}`}
            aria-pressed={value.has(day)}
            onClick={() => toggle(day)}
            style={{ padding: "0.4rem 0.7rem" }}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Paired start/end time inputs with a shared label. */
export function TimeRange({
  start,
  end,
  onStart,
  onEnd,
  label,
}: {
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  label: string;
}) {
  const inputStyle = {
    background: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.45rem 0.6rem",
    font: "inherit",
    fontSize: "0.9rem",
  } as const;

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <span className="muted" style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="time"
          aria-label={`${label} start`}
          value={start}
          onChange={(e) => onStart(e.target.value)}
          style={inputStyle}
        />
        <span className="muted">to</span>
        <input
          type="time"
          aria-label={`${label} end`}
          value={end}
          onChange={(e) => onEnd(e.target.value)}
          style={inputStyle}
        />
      </div>
    </div>
  );
}
