import type { AvailabilityResponse, DailyDetail } from "./types.ts";

const BASE_URL =
  "https://anc.apm.activecommunities.com/seattle/rest/reservation/resource/availability/daily";

const SITE = "https://anc.apm.activecommunities.com/seattle";

// Sign-in page that returns to the court's booking page afterwards (the user
// picks the date/slot there). `params` is just the Base64-encoded return URL.
export function bookingUrl(resourceId: number): string {
  const returnUrl = `${SITE}/reservation/search/detail/${resourceId}?fromLoginPage=true&from_original_cui=true`;
  const params = Buffer.from(returnUrl).toString("base64");
  return `${SITE}/signin?onlineSiteId=0&from_original_cui=true&override_partial_error=False&custom_amount=False&params=${encodeURIComponent(params)}`;
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
