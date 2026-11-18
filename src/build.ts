// Generates the static site in dist/index.html.
import { mkdir, writeFile } from "node:fs/promises";
import { getAvailability } from "./availability.ts";
import { RESOURCE_IDS } from "./config.ts";
import { renderHtml, toJson } from "./render.ts";

const OUT_DIR = "dist";

const generatedAt = new Date();
const report = await getAvailability(generatedAt);

for (const e of report.errors) console.error(`resource ${e.resourceId} failed: ${e.message}`);
if (report.errors.length === RESOURCE_IDS.length) {
  // Fail so the deploy is skipped and the last good page stays up.
  console.error("All resources failed; not writing output.");
  process.exit(1);
}

const json = toJson(report, generatedAt);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/index.html`, renderHtml(report, generatedAt));

const first = report.days[0]?.date;
const last = report.days.at(-1)?.date;
console.log(`Wrote ${OUT_DIR}/ with ${json.count} openings (${first} to ${last}).`);
