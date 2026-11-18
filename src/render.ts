import { bookingUrl } from "./api.ts";
import type { AvailabilityReport } from "./availability.ts";
import { RESOURCES } from "./config.ts";

// One open slot, flattened for the JSON output and the HTML rows.
export interface Opening {
  date: string; // "YYYY-MM-DD"
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  resourceId: number;
  court: string;
  url: string;
}

export interface AvailabilityJson {
  generatedAt: string; // ISO timestamp
  count: number;
  openings: Opening[];
  errors: { resourceId: number; court: string; message: string }[];
}

// Identifies a time slot regardless of court, for spotting new openings.
export const slotKey = (o: Opening) => `${o.date} ${o.start}-${o.end}`;

export function toJson(report: AvailabilityReport, generatedAt: Date): AvailabilityJson {
  const openings = report.days.flatMap((day) =>
    day.open.map(({ resourceId, slot }) => ({
      date: day.date,
      start: slot.start_time.slice(0, 5),
      end: slot.end_time.slice(0, 5),
      resourceId,
      court: RESOURCES[resourceId] ?? `Resource ${resourceId}`,
      url: bookingUrl(resourceId),
    })),
  );
  return {
    generatedAt: generatedAt.toISOString(),
    count: openings.length,
    openings,
    errors: report.errors.map((e) => ({ ...e, court: RESOURCES[e.resourceId] ?? "" })),
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

export function renderHtml(report: AvailabilityReport, generatedAt: Date): string {
  const data = toJson(report, generatedAt);
  const updated = pacific(generatedAt, { dateStyle: "medium", timeStyle: "short" });

  const sections = report.days
    .map((day) => {
      const windows = day.windows.length
        ? day.windows.map((w) => `${w.start}–${w.end}`).join(", ")
        : "not tracked";
      const rows = data.openings
        .filter((o) => o.date === day.date)
        .map(
          (o) => `
        <tr class="slot" data-date="${o.date}" data-start="${o.start}" data-end="${o.end}" data-resource-id="${o.resourceId}" data-court="${escapeHtml(o.court)}">
          <td>${o.start}–${o.end}</td>
          <td>${escapeHtml(o.court)}</td>
          <td><a href="${escapeHtml(o.url)}">Reserve</a></td>
        </tr>`,
        )
        .join("");
      const body = !day.windows.length
        ? ""
        : rows
          ? `<table><thead><tr><th>Time</th><th>Court</th><th></th></tr></thead><tbody>${rows}
      </tbody></table>`
          : `<p class="none">No openings</p>`;
      return `
    <section data-date="${day.date}">
      <h2>${escapeHtml(dayHeading(day.date))} <span class="windows">${escapeHtml(windows)}</span></h2>
      ${body}
    </section>`;
    })
    .join("");

  const errors = data.errors.length
    ? `<ul id="errors">${data.errors
        .map((e) => `<li data-resource-id="${e.resourceId}">${escapeHtml(e.court)} (${e.resourceId}) failed: ${escapeHtml(e.message)}</li>`)
        .join("")}</ul>`
    : "";

  // "<" escaped so the JSON can never close the <script> tag early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AYTC Court Availability</title>
  <style>
    :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #666; --line: #ddd; --bg: #fff; --link: #0b62c4; }
    @media (prefers-color-scheme: dark) { :root { --fg: #eee; --muted: #9a9a9a; --line: #333; --bg: #141414; --link: #6aa9ff; } }
    body { margin: 0 auto; max-width: 640px; padding: 16px; font: 16px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
    h1 { font-size: 1.4rem; margin: 0 0 4px; }
    h2 { font-size: 1.05rem; margin: 24px 0 8px; }
    .windows, .none, #summary { color: var(--muted); font-weight: normal; font-size: .9rem; }
    table { width: 100%; border-collapse: collapse; }
    td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
    th { font-size: .8rem; color: var(--muted); font-weight: 600; }
    a { color: var(--link); }
    #errors { color: #c0392b; }
  </style>
</head>
<body>
  <h1>AYTC Court Availability</h1>
  <p id="summary" data-count="${data.count}" data-generated-at="${data.generatedAt}">${data.count} opening${data.count === 1 ? "" : "s"} · updated ${escapeHtml(updated)}</p>
  ${errors}${sections}
  <script type="application/json" id="availability-data">${json}</script>
</body>
</html>
`;
}
