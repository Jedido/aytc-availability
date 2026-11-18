import type { AvailabilityResponse, DailyDetail } from "./types.ts";

const BASE_URL =
  "https://anc.apm.activecommunities.com/seattle/rest/reservation/resource/availability/daily";

// The court's public booking page (the user picks the date/slot there).
export function bookingUrl(resourceId: number): string {
  return `https://anc.apm.activecommunities.com/seattle/reservation/landing/search/detail/${resourceId}?locale=en-US`;
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

  const res = await fetch(`${BASE_URL}/${q.resourceId}?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const data = (await res.json()) as AvailabilityResponse;
  if (data.headers.response_code !== "0000") {
    throw new Error(`API error ${data.headers.response_code}: ${data.headers.response_message}`);
  }
  return data.body.details.daily_details;
}
