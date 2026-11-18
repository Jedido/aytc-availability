// Generates the static site in dist/ (index.html and availability.json), and
// notification.json listing openings that weren't in the previous run's availability.json.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { getAvailability } from "./availability.ts";
import { RESOURCE_IDS } from "./config.ts";
import { formatNotification, newOpenings } from "./notify.ts";
import { renderHtml, toJson, type AvailabilityJson } from "./render.ts";

const OUT_DIR = "dist";
const NOTIFICATION_FILE = "notification.json"; // outside dist/ so it's never published

// PREVIOUS_JSON is a URL (the live site) or a local path (for testing).
async function loadPrevious(source: string | undefined): Promise<AvailabilityJson | undefined> {
  if (!source) return undefined;
  try {
    if (/^https?:\/\//.test(source)) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AvailabilityJson;
    }
    return JSON.parse(await readFile(source, "utf8")) as AvailabilityJson;
  } catch (err) {
    console.warn(`No previous availability from ${source} (${(err as Error).message}); skipping notification.`);
    return undefined;
  }
}

const generatedAt = new Date();
const report = await getAvailability(generatedAt);

for (const e of report.errors) console.error(`resource ${e.resourceId} failed: ${e.message}`);
if (report.errors.length === RESOURCE_IDS.length) {
  // Fail so the deploy is skipped and the last good page stays up.
  console.error("All resources failed; not writing output.");
  process.exit(1);
}

const json = toJson(report, generatedAt);
const previous = await loadPrevious(process.env.PREVIOUS_JSON);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/index.html`, renderHtml(report, generatedAt));
await writeFile(`${OUT_DIR}/availability.json`, JSON.stringify(json, null, 2) + "\n");

await rm(NOTIFICATION_FILE, { force: true });
if (previous) {
  const fresh = newOpenings(previous.openings, json.openings);
  if (fresh.length) {
    await writeFile(NOTIFICATION_FILE, JSON.stringify(formatNotification(fresh, json.count), null, 2) + "\n");
  }
  console.log(`${fresh.length} new openings since ${previous.generatedAt}.`);
}

const first = report.days[0]?.date;
const last = report.days.at(-1)?.date;
console.log(`Wrote ${OUT_DIR}/ with ${json.count} openings (${first} to ${last}).`);
