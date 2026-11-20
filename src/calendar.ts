// Busy times from Google Calendar, so notifications skip slots you can't make.
//
// Uses the free/busy API, which returns only busy time ranges (no titles or details) and
// leaves out events marked "Free". Needs these env vars (see scripts/google-auth.ts):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_IDS   comma-separated, e.g. "primary,abc123@group.calendar.google.com"
// Without them, there are no busy times. MOCK_API=<dir> reads <dir>/busy.json instead.
import { readFile } from "node:fs/promises";

export interface Busy {
  start: Date;
  end: Date;
}

export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function accessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`token refresh failed: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim());
  }
  return body.access_token;
}

interface FreeBusyResponse {
  calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }>;
}

const toBusy = (ranges: { start: string; end: string }[]): Busy[] =>
  ranges.map((r) => ({ start: new Date(r.start), end: new Date(r.end) }));

// Busy ranges across all configured calendars between timeMin and timeMax. Throws if any
// calendar can't be read, so the caller can fall back instead of missing that calendar.
export async function getBusy(timeMin: Date, timeMax: Date): Promise<Busy[]> {
  const mockDir = process.env.MOCK_API;
  if (mockDir) {
    try {
      return toBusy(JSON.parse(await readFile(`${mockDir}/busy.json`, "utf8")));
    } catch {
      return [];
    }
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_IDS } = process.env;
  const ids = (GOOGLE_CALENDAR_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !ids.length) return [];

  const token = await accessToken(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN);
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: ids.map((id) => ({ id })),
    }),
  });
  if (!res.ok) throw new Error(`freeBusy failed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as FreeBusyResponse;

  const busy: Busy[] = [];
  // Errors are reported by position, not ID, so the log never shows a calendar ID.
  ids.forEach((id, i) => {
    const cal = body.calendars[id];
    if (!cal) throw new Error(`calendar #${i + 1} missing from freeBusy response`);
    if (cal.errors?.length) throw new Error(`calendar #${i + 1}: ${cal.errors.map((e) => e.reason).join(", ")}`);
    busy.push(...toBusy(cal.busy ?? []));
  });
  return busy;
}
