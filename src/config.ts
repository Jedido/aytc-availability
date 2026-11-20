// What to track. Edit this file to change resources or time windows.

// Resource ID -> display name (names from the resource detail API).
export const RESOURCES: Record<number, string> = {
  10: "Court #02",
  11: "Court #03",
  12: "Court #04",
  13: "Court #05",
  262: "Court #07",
  263: "Court #08",
  264: "Court #09",
  265: "Court #10",
};

export const RESOURCE_IDS = Object.keys(RESOURCES).map(Number);

export const EVENT_TYPE_ID = 157;
export const ATTENDEES = 2;

// Reservations open up to this many days after today. The newest day opens at
// BOOKING_OPENS_AT (Seattle time); before then, only DAYS_AHEAD - 1 days are bookable.
export const DAYS_AHEAD = 6;
export const BOOKING_OPENS_AT = "09:09"; // the site says 9:10; a minute early is fine

// A time window, in 24h "HH:MM". A slot matches only if it lies entirely
// inside a window (a 20:45-22:00 slot does NOT match a 17:00-21:00 window).
export interface TimeWindow {
  start: string;
  end: string;
}

const WORK_DAY: TimeWindow[] = [{ start: "16:30", end: "20:00" }];

// Windows per day of week: the page shows every open slot, but notifications only
// cover slots inside these windows. An empty array means "don't notify that day".
export const WEEKLY_WINDOWS: Record<Weekday, TimeWindow[]> = {
  sun: [{ start: "10:00", end: "17:00" }],
  mon: [{ start: "18:30", end: "20:00" }],
  tue: WORK_DAY,
  wed: [{ start: "17:30", end: "20:00" }],
  thu: WORK_DAY,
  fri: WORK_DAY,
  sat: [{ start: "10:00", end: "20:30" }],
};

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
