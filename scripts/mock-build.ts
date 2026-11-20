// Builds dist/ from generated mock API responses instead of the live reservation API.
//
//   npm run build:mock                 # two runs, so the second has "new" openings and a notification
//   npm run build:mock -- --seed 5     # a different random week
//   npm run build:mock -- --fail 265   # that court's response is an API error
//
// Responses go to mock/<resourceId>.json in the API's own shape (src/types.ts; real examples in
// fixtures/live/, captured with scripts/capture-live.ts), dated for the
// range a real build would ask for. The first run's availability.json becomes the second
// run's PREVIOUS_JSON; between runs some slots get booked and a few others open up.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { isoDate, lastBookableDate } from "../src/availability.ts";
import { RESOURCE_IDS } from "../src/config.ts";
import type { AvailabilityResponse, DailyDetail, TimeSlot } from "../src/types.ts";

const DIR = "mock";
const { values: args } = parseArgs({
  options: { seed: { type: "string", default: "1" }, fail: { type: "string", multiple: true, default: [] } },
});
const failing = new Set(args.fail.map(Number));

// Small seeded PRNG so a given --seed always produces the same week.
let state = Number(args.seed) >>> 0 || 1;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Slot grids as seen in the live API (fixtures/live/2026-11-18): 75-minute slots on two
// staggered schedules. Courts #02–#05 run 7:30 AM to 10:30 PM, or 9:15 PM Fri–Sun;
// courts #07–#10 run 8:15 AM to 10:00 PM, or 8:45 PM on Sunday.
const SLOT_MIN = 75;
const weekday = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 = Sunday
};
function schedule(resourceId: number, date: string): [string, string] {
  const day = weekday(date);
  if (resourceId < 100) return ["07:30", [5, 6, 0].includes(day) ? "21:15" : "22:30"];
  return ["08:15", day === 0 ? "20:45" : "22:00"];
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;

// Chance a slot is open, roughly matching the live capture (~9% open overall): nothing
// today, very little in the next few days, and most openings in the two newest days.
function openChance(dayIndex: number, dayCount: number): number {
  if (dayIndex === 0) return 0;
  return dayIndex >= dayCount - 2 ? 0.3 : 0.04;
}

const today = new Date();
const dates: string[] = [];
for (let d = new Date(today); isoDate(d) <= lastBookableDate(today); d.setDate(d.getDate() + 1)) dates.push(isoDate(d));

// Each day's start times (in minutes) for a court.
function startsFor(resourceId: number, date: string): number[] {
  const [first, last] = schedule(resourceId, date).map(toMin);
  const starts: number[] = [];
  for (let s = first; s + SLOT_MIN <= last; s += SLOT_MIN) starts.push(s);
  return starts;
}

// open[resourceId|date|startMin] for the first run.
const open = new Map<string, boolean>();
for (const id of RESOURCE_IDS)
  dates.forEach((date, i) => {
    for (const s of startsFor(id, date)) open.set(`${id}|${date}|${s}`, random() < openChance(i, dates.length));
  });

// Per-day status as the live API reports it: 7 = today, 4 = nothing open, 0 = has openings.
const dayStatus = (dayIndex: number, times: TimeSlot[]) => (dayIndex === 0 ? 7 : times.some((t) => t.available) ? 0 : 4);

async function writeResponses(withFailures: boolean) {
  await mkdir(DIR, { recursive: true });
  for (const id of RESOURCE_IDS) {
    const daily: DailyDetail[] = dates.map((date, i) => {
      // Live slot ids identify a time of day, not a date, so the same time repeats its id.
      const times: TimeSlot[] = startsFor(id, date).map((s) => ({
        id: 1000 + s,
        start_time: toTime(s),
        end_time: toTime(s + SLOT_MIN),
        available: open.get(`${id}|${date}|${s}`)!,
        is_cross_day: false,
      }));
      return { date, status: dayStatus(i, times), times, holiday_desc: null, check_in_only: false, check_out_only: false };
    });
    const fail = withFailures && failing.has(id);
    const headers = {
      sessionRefreshedOn: null,
      sessionExtendedCount: 0,
      response_code: fail ? "0500" : "0000",
      response_message: fail ? "Mock failure for this resource" : "Successful",
      page_info: { order_by: "", order_option: "ASC", total_page: 1, total_records_per_page: 20, total_records: 0, page_number: 1 },
    };
    const body: AvailabilityResponse = {
      headers,
      body: { details: { resource_id: id, reservation_unit: 7, daily_details: fail ? [] : daily } },
    };
    await writeFile(`${DIR}/${id}.json`, JSON.stringify(body, null, 2) + "\n");
  }
}

const build = (previous: string) =>
  execFileSync(process.execPath, ["src/build.ts"], { stdio: "inherit", env: { ...process.env, MOCK_API: DIR, PREVIOUS_JSON: previous } });

// Calendar busy times (src/calendar.ts reads mock/busy.json under MOCK_API): an evening
// event on each of the two newest days, where most openings are.
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
const busy = dates.slice(-2).map((date) => ({ start: at(date, 18), end: at(date, 19) }));
await mkdir(DIR, { recursive: true });
await writeFile(`${DIR}/busy.json`, JSON.stringify(busy, null, 2) + "\n");

// Run 1: no previous run, so nothing is "new" yet.
await writeResponses(false);
build("");
await copyFile("dist/availability.json", `${DIR}/previous.json`);

// Between runs: some open slots get booked, a few booked ones open up (cancellations).
// Today stays closed, as in the live API.
for (const [key, isOpen] of open) {
  if (key.includes(`|${dates[0]}|`)) continue;
  open.set(key, isOpen ? random() > 0.15 : random() < 0.02);
}

// Run 2: compared against run 1, so cancellations show as new and produce notification.json.
await writeResponses(true);
build(`${DIR}/previous.json`);
console.log(`Mock responses are in ${DIR}/; open dist/index.html to view.`);
