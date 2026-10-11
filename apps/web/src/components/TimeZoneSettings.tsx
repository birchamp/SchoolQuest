import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { browserTimeZone } from "../lib/clock";
import type { Me } from "../lib/types";

/**
 * Which zone the student's times are shown in, and their weekly hours are read in.
 *
 * Every time the app stores is UTC; this decides only how those times are shown and where the
 * student's "Mondays three to ten" fall. Following the device is right for almost everyone, and
 * for a term abroad, where the classes moved too. It is wrong for a trip home, where they did
 * not: pinning keeps the plan on school time wherever the laptop is.
 */
export function TimeZoneSettings({ me, onChanged }: { me: Me; onChanged: () => Promise<void> | void }) {
  const device = browserTimeZone();
  const pinned = me.timezoneMode === "pinned";
  const [zone, setZone] = useState(me.timezone);
  // Back in step whenever the saved zone changes: after "Follow this device" the picker went on
  // showing the old pin, and "Pin it" would have pinned that instead. Found in review.
  useEffect(() => setZone(me.timezone), [me.timezone, me.timezoneMode]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => allZones(me.timezone, device), [me.timezone, device]);

  async function save(body: { timezone?: string; timezoneMode: "device" | "pinned" }) {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/api/me", body);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="time-zone-heading" data-testid="time-zone-settings">
      <h2 id="time-zone-heading">Time zone</h2>
      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        Your times are shown in <strong>{labelOf(me.timezone)}</strong>
        {pinned ? ", which you pinned." : ", this device's time zone."}
        {pinned && device && device !== me.timezone && <> This device is in {labelOf(device)}.</>}
      </p>
      <div className="button-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        {pinned ? (
          <button
            type="button"
            className="action"
            disabled={busy || !device}
            onClick={() => void save({ timezoneMode: "device", ...(device ? { timezone: device } : {}) })}
          >
            Follow this device{device ? ` (${labelOf(device)})` : ""}
          </button>
        ) : null}
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <span>{pinned ? "Pinned to" : "Keep it on"}</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)} disabled={busy}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {labelOf(z)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="action"
          disabled={busy || (pinned && zone === me.timezone)}
          onClick={() => void save({ timezone: zone, timezoneMode: "pinned" })}
        >
          {pinned ? "Change" : "Pin it"}
        </button>
      </div>
      <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
        Pin it when you are away from home but your classes are not. Deadlines stay at the same real
        moment either way; your study hours and class times follow the zone shown here.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** "America/Chicago" -> "Chicago (America)". Readable, and still unambiguous. */
export function labelOf(zone: string): string {
  const parts = zone.split("/");
  if (parts.length < 2) return zone;
  return `${parts[parts.length - 1]!.replace(/_/g, " ")} (${parts[0]!.replace(/_/g, " ")})`;
}

function allZones(current: string, device: string | null): string[] {
  return [...new Set([current, ...(device ? [device] : []), ...supportedZones()])].sort();
}

/** Every zone the browser knows, or none where it will not say. */
function supportedZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}
