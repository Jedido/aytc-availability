import { bookingUrl } from "./api.ts";
import { getAvailability } from "./availability.ts";
import { RESOURCES } from "./config.ts";

const hm = (t: string) => t.slice(0, 5);

const { days, errors } = await getAvailability();

for (const day of days) {
  const windows = day.windows.length
    ? day.windows.map((w) => `${w.start}-${w.end}`).join(", ")
    : "not tracked";
  console.log(`\n${day.date} (${day.weekday})  windows: ${windows}`);
  if (!day.windows.length) continue;
  if (!day.open.length) {
    console.log("  no openings");
    continue;
  }
  for (const { resourceId, slot } of day.open) {
    const time = `${hm(slot.start_time)}-${hm(slot.end_time)}`;
    console.log(`  ${time}  ${RESOURCES[resourceId].padEnd(10)} ${bookingUrl(resourceId)}`);
  }
}

for (const e of errors) console.error(`\n${RESOURCES[e.resourceId]} (${e.resourceId}) failed: ${e.message}`);
