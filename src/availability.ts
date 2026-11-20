import { fetchAvailability } from "./api.ts";
import type { Busy } from "./calendar.ts";
import {
  ATTENDEES,
  BOOKING_OPENS_AT,
  DAYS_AHEAD,
  EVENT_TYPE_ID,
  RESOURCE_IDS,
  WEEKLY_WINDOWS,
  type TimeWindow,
  type Weekday,
} from "./config.ts";
import type { TimeSlot } from "./types.ts";

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface OpenSlot {
  resourceId: number;
  slot: TimeSlot;
  watched: boolean; // inside the day's time windows, so the notifier cares about it
}

export interface DayAvailability {
  date: string; // "YYYY-MM-DD"
  weekday: Weekday;
  windows: TimeWindow[];
  open: OpenSlot[]; // all available slots, sorted by time
}

export interface AvailabilityReport {
  days: DayAvailability[];
  starts: string[]; // every slot start time ("HH:MM") any court offers, open or booked, sorted
  errors: { resourceId: number; message: string }[];
}

// Local-date "YYYY-MM-DD" (toISOString would use UTC and can be a day off).
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export function windowsFor(date: string): TimeWindow[] {
  return WEEKLY_WINDOWS[weekdayOf(date)];
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const seattleParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Seattle date ("YYYY-MM-DD") and minutes past midnight of an instant.
function seattleTime(d: Date): { date: string; min: number } {
  const p = Object.fromEntries(seattleParts.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

// The windows minus busy times on that date. A busy range that runs past midnight is
// clipped to the date (00:00 to "24:00").
export function subtractBusy(windows: TimeWindow[], date: string, busy: Busy[]): TimeWindow[] {
  let free = windows.map((w): [number, number] => [toMin(w.start), toMin(w.end)]);
  for (const b of busy) {
    const s = seattleTime(b.start);
    const e = seattleTime(b.end);
    if (s.date > date || e.date < date) continue;
    const from = s.date < date ? 0 : s.min;
    const to = e.date > date ? 24 * 60 : e.min;
    free = free.flatMap(([ws, we]): [number, number][] =>
      to <= ws || from >= we
        ? [[ws, we]]
        : ([[ws, from], [to, we]] as [number, number][]).filter(([a, z]) => z > a),
    );
  }
  return free.map(([s, e]) => ({ start: toTime(s), end: toTime(e) }));
}

// "HH:MM" and "HH:MM:SS" compare correctly as strings once cut to 5 chars.
function inWindows(slot: TimeSlot, windows: TimeWindow[]): boolean {
  if (slot.is_cross_day) return false;
  const start = slot.start_time.slice(0, 5);
  const end = slot.end_time.slice(0, 5);
  return windows.some((w) => start >= w.start && end <= w.end);
}

// "HH:MM" of a local time, for comparing against BOOKING_OPENS_AT.
const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Last date that can be booked right now: the newest day isn't open until BOOKING_OPENS_AT.
export function lastBookableDate(now: Date): string {
  const end = new Date(now);
  end.setDate(now.getDate() + DAYS_AHEAD - (clock(now) < BOOKING_OPENS_AT ? 1 : 0));
  return isoDate(end);
}

// busy: calendar busy times, cut out of each day's watched windows.
export async function getAvailability(today = new Date(), busy: Busy[] = []): Promise<AvailabilityReport> {
  const startDate = isoDate(today);
  const endDate = lastBookableDate(today);

  const results = await Promise.allSettled(
    RESOURCE_IDS.map((resourceId) =>
      fetchAvailability({ resourceId, startDate, endDate, eventTypeId: EVENT_TYPE_ID, attendees: ATTENDEES }),
    ),
  );

  const days = new Map<string, DayAvailability>();
  for (let d = new Date(today); isoDate(d) <= endDate; d.setDate(d.getDate() + 1)) {
    const date = isoDate(d);
    days.set(date, { date, weekday: weekdayOf(date), windows: subtractBusy(windowsFor(date), date, busy), open: [] });
  }

  const errors: AvailabilityReport["errors"] = [];
  const starts = new Set<string>();
  results.forEach((result, i) => {
    const resourceId = RESOURCE_IDS[i];
    if (result.status === "rejected") {
      errors.push({ resourceId, message: String(result.reason?.message ?? result.reason) });
      return;
    }
    for (const detail of result.value) {
      const day = days.get(detail.date);
      if (!day) continue;
      for (const slot of detail.times) {
        starts.add(slot.start_time.slice(0, 5));
        if (slot.available) day.open.push({ resourceId, slot, watched: inWindows(slot, day.windows) });
      }
    }
  });

  for (const day of days.values()) {
    day.open.sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time) || a.resourceId - b.resourceId);
  }
  return { days: [...days.values()], starts: [...starts].sort(), errors };
}
