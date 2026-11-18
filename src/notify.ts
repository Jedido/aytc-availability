// Works out which time slots are newly open since the last run and phrases the push notification.
// Courts don't matter here: a slot counts as open if any court has it.
import { dayHeading, slotKey, type Opening, type StoredOpening } from "./render.ts";

const MAX_LINES = 6;

// One opening per time slot, keeping the first (openings are sorted by date and time).
export function uniqueSlots(openings: Opening[]): Opening[] {
  const bySlot = new Map<string, Opening>();
  for (const o of openings) if (!bySlot.has(slotKey(o))) bySlot.set(slotKey(o), o);
  return [...bySlot.values()];
}

// Time slots open now that had no open court in the previous run.
export function newSlots(prev: StoredOpening[], curr: Opening[]): Opening[] {
  const seen = new Set(prev.map(slotKey));
  return uniqueSlots(curr).filter((o) => !seen.has(slotKey(o)));
}

// "16:15" -> "4:15pm"
function time(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

export function formatNotification(fresh: Opening[], totalSlots: number): { title: string; body: string } {
  const n = fresh.length;
  const lines = fresh.slice(0, MAX_LINES).map((o) => `${dayHeading(o.date, "short")} · ${time(o.start)}–${time(o.end)}`);
  if (n > MAX_LINES) lines.push(`+${n - MAX_LINES} more`);
  lines.push(`${totalSlots} open in all`);
  return { title: `${n} new opening${n === 1 ? "" : "s"}`, body: lines.join("\n") };
}
