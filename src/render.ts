import { bookingUrl } from "./api.ts";
import type { AvailabilityReport } from "./availability.ts";
import { RESOURCES } from "./config.ts";

// One open court slot as saved in availability.json: only what the next run needs to tell
// what's new. Everything else is derived from config when rendering.
export interface StoredOpening {
  date: string; // "YYYY-MM-DD"
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  resourceId: number;
  firstSeen: string | null; // ISO time this court slot was first seen open; null if unknown
}

// The published availability.json, read back by the next run as PREVIOUS_JSON.
export interface AvailabilityJson {
  generatedAt: string; // ISO timestamp
  openings: StoredOpening[];
  errors: { resourceId: number; message: string }[];
}

// A stored opening plus the details the page and notifications show.
export interface Opening extends StoredOpening {
  court: string;
  url: string;
  watched: boolean; // inside the day's time windows; only these trigger notifications
}

// Everything about this run, for rendering and notifications.
export interface Availability {
  generatedAt: string;
  openings: Opening[];
  errors: { resourceId: number; court: string; message: string }[];
}

const courtName = (resourceId: number) => RESOURCES[resourceId] ?? `Resource ${resourceId}`;

// Identifies a time slot regardless of court, for spotting new openings.
export const slotKey = (o: Pick<StoredOpening, "date" | "start" | "end">) => `${o.date} ${o.start}-${o.end}`;

// Identifies one court's time slot, for tracking when it first opened.
const courtSlotKey = (o: Pick<StoredOpening, "date" | "start" | "end" | "resourceId">) =>
  `${o.date} ${o.start}-${o.end} #${o.resourceId}`;

// Openings that first appeared within this long before a run are marked new on the page.
const NEW_FOR_MS = 60 * 60 * 1000;

export const isNew = (o: StoredOpening, generatedAt: string) =>
  o.firstSeen !== null && Date.parse(generatedAt) - Date.parse(o.firstSeen) < NEW_FOR_MS;

// firstSeen is carried over from the previous run. Without a previous run there's no way
// to tell what's new, so it stays null (rather than marking everything new).
export function collectAvailability(report: AvailabilityReport, generatedAt: Date, previous?: AvailabilityJson): Availability {
  const now = generatedAt.toISOString();
  // A previous run from before firstSeen existed (it also left out unwatched slots) can't
  // say what's new, so it's ignored here.
  if (previous && !previous.openings.every((o) => o.firstSeen !== undefined)) previous = undefined;
  // Openings from before firstSeen was tracked have no time; they stay null (never new).
  const seen = new Map<string, string | null>();
  for (const o of previous?.openings ?? []) seen.set(courtSlotKey(o), o.firstSeen ?? null);

  const openings = report.days.flatMap((day) =>
    day.open.map(({ resourceId, slot, watched }) => {
      const o = { date: day.date, start: slot.start_time.slice(0, 5), end: slot.end_time.slice(0, 5), resourceId };
      return {
        ...o,
        court: courtName(resourceId),
        url: bookingUrl(resourceId),
        watched,
        firstSeen: !previous ? null : seen.has(courtSlotKey(o)) ? seen.get(courtSlotKey(o))! : now,
      };
    }),
  );
  return {
    generatedAt: now,
    openings,
    errors: report.errors.map((e) => ({ ...e, court: courtName(e.resourceId) })),
  };
}

// The slim form saved as availability.json.
export function toJson(a: Availability): AvailabilityJson {
  return {
    generatedAt: a.generatedAt,
    openings: a.openings.map(({ date, start, end, resourceId, firstSeen }) => ({ date, start, end, resourceId, firstSeen })),
    errors: a.errors.map(({ resourceId, message }) => ({ resourceId, message })),
  };
}

const escapeHtml = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pacific = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", ...opts }).format(d);

export function dayHeading(date: string, weekday: "long" | "short" = "long"): string {
  const [y, m, d] = date.split("-").map(Number);
  // Noon UTC keeps the calendar date stable in any time zone.
  return pacific(new Date(Date.UTC(y, m - 1, d, 12)), { weekday, month: "short", day: "numeric" });
}

// "16:15" -> "4:15p" (grid labels) or "4:15 PM"
function clock(time: string, style: "short" | "long" = "long"): string {
  const [h, m] = time.split(":").map(Number);
  const hm = `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
  return style === "short" ? `${hm}${h < 12 ? "a" : "p"}` : `${hm} ${h < 12 ? "AM" : "PM"}`;
}

// "16:15", "17:30" -> "4:15–5:30 PM"; "11:15", "12:30" -> "11:15 AM–12:30 PM"
function clockRange(start: string, end: string): string {
  const [s, e] = [clock(start), clock(end)];
  return s.slice(-2) === e.slice(-2) ? `${s.slice(0, -3)}–${e}` : `${s}–${e}`;
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// The slot length in minutes when every opening has the same one (1h 15m on the real site),
// so the page can show start times only; null if lengths vary.
function fixedLength(openings: Opening[]): number | null {
  const lengths = new Set(openings.map((o) => minutes(o.end) - minutes(o.start)));
  return lengths.size === 1 ? [...lengths][0] : null;
}

// 75 -> "1h 15m"
const duration = (min: number) => [Math.floor(min / 60) && `${Math.floor(min / 60)}h`, min % 60 && `${min % 60}m`].filter(Boolean).join(" ");

// Openings bucketed by day and exact start time, for the grid. The two court groups run
// staggered schedules, so each start time gets its own row.
const cellKey = (date: string, start: string) => `${date}|${start}`;
function buildGrid(openings: Opening[]): { starts: string[]; cells: Map<string, Opening[]> } {
  const cells = new Map<string, Opening[]>();
  for (const o of openings) {
    const key = cellKey(o.date, o.start);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(o);
  }
  return { starts: [...new Set(openings.map((o) => o.start))].sort(), cells };
}

// Shade level for a cell by how many courts are open at that time (at most 4 share a start time).
const heatLevel = (courts: number) => Math.min(courts, 3);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// data is collectAvailability(report, ...), passed in so build.ts computes firstSeen only once.
export function renderHtml(report: AvailabilityReport, data: Availability): string {
  const updated = pacific(new Date(data.generatedAt), { dateStyle: "medium", timeStyle: "short" });
  const fresh = (o: Opening) => isNew(o, data.generatedAt);
  const times = new Set(data.openings.map(slotKey)).size;
  const watchedTimes = new Set(data.openings.filter((o) => o.watched).map(slotKey)).size;
  const newTimes = new Set(data.openings.filter(fresh).map(slotKey)).size;

  // With one fixed slot length, a start time says it all; otherwise show the range.
  const length = fixedLength(data.openings);
  const timeText = (o: Opening) => (length ? clock(o.start) : `${clock(o.start)}–${clock(o.end)}`);

  // One big link per open court, to reserve it.
  const courtLinks = (courts: Opening[]) =>
    courts
      .map(
        (c) =>
          `<a class="book" href="${escapeHtml(c.url)}" data-resource-id="${c.resourceId}" data-new="${fresh(c)}">${escapeHtml(c.court)}${fresh(c) ? ` <em>new</em>` : ""}<span>Reserve ›</span></a>`,
      )
      .join("\n    ");

  // Grid: days across, start times down. Each non-empty cell is a button that opens its own
  // popover, styled as a bottom sheet. Popovers need no script: the browser opens them and
  // closes them on Esc or a tap outside.
  const { starts, cells } = buildGrid(data.openings);
  const dayHead = report.days
    .map((day) => {
      const [weekday, monthDay] = dayHeading(day.date, "short").split(", ");
      return `<div class="dayhead">${escapeHtml(weekday)}<span>${escapeHtml(monthDay.split(" ")[1] ?? "")}</span></div>`;
    })
    .join("");
  const sheets: string[] = [];
  const gridRows = starts
    .map((start, i) => {
      const row = report.days.map((day) => {
        const slots = cells.get(cellKey(day.date, start));
        if (!slots) return `<span class="cell empty"></span>`;
        const o = slots[0];
        const courts = slots.length;
        const id = `slot-${day.date}-${start.replace(":", "")}`;
        const cls = ["cell", `heat${heatLevel(courts)}`, slots.some(fresh) && "new"].filter(Boolean).join(" ");
        const label = `${dayHeading(day.date)}, ${timeText(o)}: ${plural(courts, "court")} open`;
        const meta = [`${plural(courts, "court")} open`, o.watched && "watched"].filter(Boolean).join(" · ");
        // The sheet always shows the full range, since that's where you decide to book.
        sheets.push(`
  <div class="sheet" id="${id}" popover>
    <div class="sheet-head"><h2>${escapeHtml(dayHeading(day.date))} · ${clockRange(o.start, o.end)}</h2><button type="button" class="close" popovertarget="${id}" popovertargetaction="hide" aria-label="Close">✕</button></div>
    <p class="meta">${meta}</p>
    ${courtLinks(slots)}
  </div>`);
        return `<button type="button" class="${cls}" popovertarget="${id}" data-date="${day.date}" data-start="${start}" data-count="${courts}" aria-label="${escapeHtml(label)}">${courts}</button>`;
      });
      // The first start time in each hour gets a darker label, to help the eye scan.
      const newHour = start.slice(0, 2) !== starts[i - 1]?.slice(0, 2);
      return `<div class="hour${newHour ? " first" : ""}">${clock(start, "short")}</div>${row.join("")}`;
    })
    .join("\n    ");
  const grid = starts.length
    ? `
  <div id="grid" style="grid-template-columns: 3rem repeat(${report.days.length}, minmax(0, 1fr))">
    <div></div>${dayHead}
    ${gridRows}
  </div>
  <p class="legend">Number = courts open at that time${length ? ` · slots are ${duration(length)}` : ""} · <span class="key-dot"></span> new this hour</p>${sheets.join("")}`
    : `<p class="none">No openings this week.</p>`;

  // The summary line only counts errors; the details go at the bottom.
  const errorNote = data.errors.length ? ` · <a class="key-error" href="#errors">${plural(data.errors.length, "error")}</a>` : "";
  const errors = data.errors.length
    ? `
  <ul id="errors">${data.errors
    .map((e) => `<li data-resource-id="${e.resourceId}">${escapeHtml(e.court)} (${e.resourceId}) failed: ${escapeHtml(e.message)}</li>`)
    .join("")}</ul>`
    : "";


  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AYTC Court Availability</title>
  <style>
    :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #666; --line: #ddd; --bg: #fff; --link: #0b62c4; --watch-bg: #eaf2fc; --new: #1e9e4a; --error: #c0392b; --heat-1: #dbe9fa; --heat-2: #9cc4f1; --heat-3: #2f7fd8; }
    @media (prefers-color-scheme: dark) { :root { --fg: #eee; --muted: #9a9a9a; --line: #333; --bg: #141414; --link: #6aa9ff; --watch-bg: #1a2636; --new: #3ccf6e; --error: #ff6b5b; --heat-1: #1c2c42; --heat-2: #24497a; --heat-3: #2f74c8; } }
    body { margin: 0 auto; max-width: 640px; padding: 16px; font: 16px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
    h1 { font-size: 1.4rem; margin: 0 0 4px; }
    .none, #summary { color: var(--muted); font-weight: normal; font-size: .9rem; }
    a { color: var(--link); }
    .key-watched { background: var(--watch-bg); font-weight: 600; padding: 0 4px; border-radius: 3px; color: var(--fg); }
    .key-new { border-left: 3px solid var(--new); padding-left: 4px; color: var(--fg); }
    .key-error { color: var(--error); font-weight: 600; white-space: nowrap; }
    #errors { color: var(--error); font-size: .85rem; margin-top: 32px; padding-left: 20px; }
    #grid { display: grid; gap: 3px; margin-top: 16px; }
    .dayhead { text-align: center; font-size: .8rem; color: var(--muted); line-height: 1.2; padding-bottom: 4px; }
    .dayhead span { display: block; font-size: 1.05rem; font-weight: 600; color: var(--fg); }
    .hour { font-size: .75rem; color: var(--muted); text-align: right; padding-right: 6px; align-self: center; white-space: nowrap; }
    .hour.first { color: var(--fg); }
    .cell { position: relative; min-height: 36px; min-width: 0; border-radius: 6px; border: 0; padding: 0; font: inherit; font-size: .95rem; color: var(--fg); }
    .cell.empty { background: transparent; border: 1px solid var(--line); opacity: .5; }
    button.cell { cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .heat1 { background: var(--heat-1); }
    .heat2 { background: var(--heat-2); }
    .heat3 { background: var(--heat-3); color: #fff; }
    .cell.new::after { content: ""; position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--new); }
    .legend { color: var(--muted); font-size: .8rem; margin: 8px 0 0; }
    .key-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--new); }
    /* Bottom sheet: pinned to the bottom edge, full width up to the page width. */
    .sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 640px; height: auto; max-height: 80vh; overflow-y: auto; box-sizing: border-box; border: 0; border-radius: 16px 16px 0 0; padding: 8px 16px calc(20px + env(safe-area-inset-bottom)); background: var(--bg); color: var(--fg); box-shadow: 0 -6px 30px rgba(0, 0, 0, .3); }
    .sheet::backdrop { background: rgba(0, 0, 0, .4); }
    .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sheet h2 { font-size: 1.1rem; margin: 0; }
    .close { border: 0; background: transparent; color: var(--muted); font-size: 1.2rem; min-width: 44px; min-height: 44px; margin-right: -12px; cursor: pointer; }
    .meta { color: var(--muted); font-size: .85rem; margin: 0 0 8px; }
    .book { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 14px; margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; color: var(--fg); font-weight: 600; text-decoration: none; }
    .book span { margin-left: auto; color: var(--link); font-weight: 500; }
    .book em { font-style: normal; font-size: .75rem; font-weight: 600; color: var(--new); }
  </style>
</head>
<body>
  <h1>AYTC Court Availability</h1>
  <p id="summary" data-count="${data.openings.length}" data-generated-at="${data.generatedAt}">${times} open time${times === 1 ? "" : "s"} · <span class="key-watched">${watchedTimes} watched</span> · <span class="key-new">${newTimes} new this hour</span>${errorNote} · updated ${escapeHtml(updated)}</p>
  ${grid}${errors}
</body>
</html>
`;
}
