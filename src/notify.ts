// Works out which openings are new since the last run and phrases the push notification.
import { dayHeading, openingKey, type Opening } from "./render.ts";

const MAX_LINES = 6;

export function newOpenings(prev: Opening[], curr: Opening[]): Opening[] {
  const seen = new Set(prev.map(openingKey));
  return curr.filter((o) => !seen.has(openingKey(o)));
}

// "16:15" -> "4:15pm"
function time(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

export function formatNotification(fresh: Opening[], total: number): { title: string; body: string } {
  const n = fresh.length;
  const lines = fresh
    .slice(0, MAX_LINES)
    .map((o) => `${dayHeading(o.date, "short")} · ${time(o.start)}–${time(o.end)} · ${o.court}`);
  if (n > MAX_LINES) lines.push(`+${n - MAX_LINES} more`);
  lines.push(`${total} open in all`);
  return { title: `${n} new court opening${n === 1 ? "" : "s"}`, body: lines.join("\n") };
}
