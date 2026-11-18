import { fetchAvailability } from "./api.ts";
import {
  ATTENDEES,
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
}

export interface DayAvailability {
  date: string; // "YYYY-MM-DD"
  weekday: Weekday;
  windows: TimeWindow[];
  open: OpenSlot[]; // available slots inside the day's windows, sorted by time
}

export interface AvailabilityReport {
  days: DayAvailability[];
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

// "HH:MM" and "HH:MM:SS" compare correctly as strings once cut to 5 chars.
function inWindows(slot: TimeSlot, windows: TimeWindow[]): boolean {
  if (slot.is_cross_day) return false;
  const start = slot.start_time.slice(0, 5);
  const end = slot.end_time.slice(0, 5);
  return windows.some((w) => start >= w.start && end <= w.end);
}

export async function getAvailability(today = new Date()): Promise<AvailabilityReport> {
  const end = new Date(today);
  end.setDate(today.getDate() + DAYS_AHEAD);
  const startDate = isoDate(today);
  const endDate = isoDate(end);

  const results = await Promise.allSettled(
    RESOURCE_IDS.map((resourceId) =>
      fetchAvailability({ resourceId, startDate, endDate, eventTypeId: EVENT_TYPE_ID, attendees: ATTENDEES }),
    ),
  );

  const days = new Map<string, DayAvailability>();
  for (let d = new Date(today); isoDate(d) <= endDate; d.setDate(d.getDate() + 1)) {
    const date = isoDate(d);
    days.set(date, { date, weekday: weekdayOf(date), windows: windowsFor(date), open: [] });
  }

  const errors: AvailabilityReport["errors"] = [];
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
        if (slot.available && inWindows(slot, day.windows)) day.open.push({ resourceId, slot });
      }
    }
  });

  for (const day of days.values()) {
    day.open.sort((a, b) => a.slot.start_time.localeCompare(b.slot.start_time) || a.resourceId - b.resourceId);
  }
  return { days: [...days.values()], errors };
}
