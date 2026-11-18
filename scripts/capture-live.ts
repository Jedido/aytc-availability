// Saves the live API's raw responses for every court, for reference and for realistic mocks.
// This DOES call the live reservation API: one request per court, like a real build.
//
//   node scripts/capture-live.ts     # writes fixtures/live/<today>/<resourceId>.json
import { mkdir, writeFile } from "node:fs/promises";
import { isoDate, lastBookableDate } from "../src/availability.ts";
import { ATTENDEES, EVENT_TYPE_ID, RESOURCES, RESOURCE_IDS } from "../src/config.ts";

const BASE_URL = "https://anc.apm.activecommunities.com/seattle/rest/reservation/resource/availability/daily";

const now = new Date();
const startDate = isoDate(now);
const endDate = lastBookableDate(now);
const dir = `fixtures/live/${startDate}`;
await mkdir(dir, { recursive: true });

for (const id of RESOURCE_IDS) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    customer_id: "0",
    company_id: "0",
    event_type_id: String(EVENT_TYPE_ID),
    attendee: String(ATTENDEES),
  });
  const res = await fetch(`${BASE_URL}/${id}?${params}`, { headers: { Accept: "application/json" } });
  const body = await res.text();
  // Kept verbatim (just pretty-printed) so it shows every field the API returns.
  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {}
  await writeFile(`${dir}/${id}.json`, pretty + "\n");
  console.log(`${RESOURCES[id]} (${id}): HTTP ${res.status}, ${body.length} bytes`);
}
await writeFile(`${dir}/README.md`, `Raw responses captured ${now.toISOString()} for ${startDate} to ${endDate} (scripts/capture-live.ts).\n`);
console.log(`Saved to ${dir}/`);
