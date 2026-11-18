import { readFile } from "node:fs/promises";
import type { AvailabilityResponse, DailyDetail } from "./types.ts";

// MOCK_API=<dir> reads canned responses from <dir>/<resourceId>.json instead of calling the
// live API (see scripts/mock-build.ts).
const MOCK_DIR = process.env.MOCK_API;

const BASE_URL =
  "https://anc.apm.activecommunities.com/seattle/rest/reservation/resource/availability/daily";

// The court's public booking page (the user picks the date/slot there).
export function bookingUrl(resourceId: number): string {
  return `https://anc.apm.activecommunities.com/seattle/reservation/search/detail/${resourceId}`;
}

export interface AvailabilityQuery {
  resourceId: number;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  eventTypeId: number;
  attendees: number;
}

export async function fetchAvailability(q: AvailabilityQuery): Promise<DailyDetail[]> {
  const params = new URLSearchParams({
    start_date: q.startDate,
    end_date: q.endDate,
    customer_id: "0",
    company_id: "0",
    event_type_id: String(q.eventTypeId),
    attendee: String(q.attendees),
  });

  let data: AvailabilityResponse;
  if (MOCK_DIR) {
    data = JSON.parse(await readFile(`${MOCK_DIR}/${q.resourceId}.json`, "utf8"));
  } else {
    const res = await fetch(`${BASE_URL}/${q.resourceId}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    data = (await res.json()) as AvailabilityResponse;
  }
  if (data.headers.response_code !== "0000") {
    throw new Error(`API error ${data.headers.response_code}: ${data.headers.response_message}`);
  }
  return data.body.details.daily_details;
}
