import type { SlotKind } from "@schoolquest/planning-engine";

/**
 * The key that ties each band colour to its meaning.
 *
 * Colour on the calendars is a shortcut for a reader who has learned it, never the only
 * carrier of the fact — every band also spells out its kind — so this legend is what turns the
 * green stripe into "study" the first time, after which the colour stands on its own. It is
 * shared by the hour-by-hour grid and the operations board precisely so a green block means the
 * same thing on both; the colours themselves live in styles.css as the `--cal-*` variables the
 * contrast checker measures.
 *
 * Only the kinds a surface actually paints are passed in. The board draws study and meals, so
 * it names those two rather than promising a class colour it never shows; the hour grid draws
 * all four and names all four.
 */
const LEGEND_LABEL: Record<SlotKind, string> = {
  class: "Classes",
  study: "Study",
  meal: "Meals",
  commitment: "Other commitments",
  free: "Free",
  off: "Off",
};

export function CalendarLegend({ kinds }: { kinds: SlotKind[] }) {
  return (
    <ul className="cal-legend" aria-label="What the calendar colours mean">
      {kinds.map((kind) => (
        <li key={kind}>
          <span
            className="cal-swatch"
            aria-hidden="true"
            style={{ background: `var(--cal-${kind})` }}
          />
          {LEGEND_LABEL[kind]}
        </li>
      ))}
    </ul>
  );
}
