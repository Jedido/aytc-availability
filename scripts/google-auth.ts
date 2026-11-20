// One-time setup: gets a Google refresh token with free/busy access to your calendars,
// for the GOOGLE_REFRESH_TOKEN secret (src/calendar.ts).
//
//   npm run calendar:auth      # reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env
//   npm run calendar:check     # prints the busy times the build would use
//
// Copy .env.example to .env (git-ignored) and fill it in.
//
// The client must be a "Desktop app" OAuth client, and the consent screen must be "In
// production" (in Testing, refresh tokens expire after 7 days). Open the printed URL,
// approve (click past "Google hasn't verified this app"), and the token is printed here.
//
// With GOOGLE_REFRESH_TOKEN and GOOGLE_CALENDAR_IDS also set, pass --check instead to print
// the busy times the build would use, to compare against your calendar.
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { isoDate, lastBookableDate } from "../src/availability.ts";
import { FREEBUSY_SCOPE, getBusy, TOKEN_URL } from "../src/calendar.ts";

const { values: args } = parseArgs({ options: { check: { type: "boolean", default: false } } });

if (args.check) {
  const now = new Date();
  const [y, m, d] = lastBookableDate(now).split("-").map(Number);
  const busy = await getBusy(new Date(now.getFullYear(), now.getMonth(), now.getDate()), new Date(y, m - 1, d + 1));
  const fmt = (t: Date) => t.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" });
  console.log(`Busy from ${isoDate(now)} to ${lastBookableDate(now)}:`);
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const b of busy) console.log(`  ${fmt(b.start)} – ${fmt(b.end)}`);
  if (!busy.length) console.log("  (none; check that all four GOOGLE_ env vars are set)");
  process.exit(0);
}

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

// Google redirects back to this local server with the authorization code.
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end(`No code in the redirect: ${url.searchParams.get("error") ?? "unknown error"}`);
    return;
  }
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (body.refresh_token) {
    res.end("Done. The refresh token is in your terminal; you can close this tab.");
    console.log(`\nGOOGLE_REFRESH_TOKEN:\n${body.refresh_token}\n`);
  } else {
    res.end("No refresh token came back; see the terminal.");
    console.error(`Token exchange failed: ${body.error ?? tokenRes.status} ${body.error_description ?? ""}`);
  }
  server.close();
});

// A fixed port, so a "Web application" client can list this exact URI as an authorized
// redirect URI ("Desktop app" clients accept any loopback port).
const PORT = 8085;
const redirectUri = `http://127.0.0.1:${PORT}`;
server.listen(PORT, "127.0.0.1", () => {
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: FREEBUSY_SCOPE,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // and get a new one even if you approved before
  }).toString();
  console.log(`Open this URL in your browser:\n\n${auth}\n\nWaiting for Google to redirect back...`);
});
