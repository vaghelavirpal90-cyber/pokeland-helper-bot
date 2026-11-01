const WEBSITE_URL = "https://pokeland-helper-3sm.pages.dev/";
const REMINDER_WEBHOOK_URL = process.env.REMINDER_WEBHOOK_URL;
const WELCOME_WEBHOOK_URL = process.env.WELCOME_WEBHOOK_URL;
const HKT = "Asia/Hong_Kong";

function hktParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HKT, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(date);
  const result = {};
  for (const p of parts) if (p.type !== "literal") result[p.type] = Number(p.value);
  return result;
}

function parseDateUtcCall(html) {
  const match = html.match(/const\s+REF_TIME\s*=\s*Date\.UTC\(([^)]*)\)\s*;/);
  if (!match) throw new Error("Website timer reference not found.");
  const args = match[1].split(",").map(v => Number(v.trim()));
  if (args.length < 3 || args.some(v => !Number.isFinite(v))) throw new Error("Invalid website timer reference.");
  return Date.UTC(...args);
}

function parseSchedule(html) {
  const block = html.match(/const\s+DAILY_EVENTS\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!block) throw new Error("Website event schedule not found.");
  const re = /\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*icon:\s*'([^']*)'\s*,\s*desc:\s*'([^']*)'\s*,\s*h:\s*(\d+)\s*,\s*m:\s*(\d+)\s*,\s*dur:\s*(\d+)\s*,\s*dow:\s*(null|\d+)\s*\}/g;
  const events = [];
  let m;
  while ((m = re.exec(block[1]))) events.push({
    id: m[1], name: m[2], icon: m[3] || "📅", hour: +m[5], minute: +m[6],
    duration: +m[7], dow: m[8] === "null" ? null : +m[8]
  });
  if (!events.length) throw new Error("No events parsed from website.");
  return events;
}

async function sendWebhook(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Discord webhook returned HTTP " + response.status);
}

async function reminderCheck() {
  if (!REMINDER_WEBHOOK_URL) throw new Error("Missing REMINDER_WEBHOOK_URL GitHub secret.");
  const response = await fetch(WEBSITE_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Website returned HTTP " + response.status);
  const html = await response.text();
  const events = parseSchedule(html);
  const now = Date.now();
  const local = hktParts(new Date(now));
  const today = Date.UTC(local.year, local.month - 1, local.day);
  const matches = [];

  for (let offset = 0; offset <= 1; offset++) {
    const day = new Date(today + offset * 86400000);
    for (const event of events) {
      if (event.dow !== null && event.dow !== day.getUTCDay()) continue;
      const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), event.hour - 8, event.minute);
      const remaining = start - now;
      if (remaining > 0 && remaining <= 5 * 60 * 1000) matches.push({ ...event, start, remaining });
    }
  }

  if (!matches.length) {
    console.log("No event starts within the next five minutes.");
    return;
  }

  for (const event of matches) {
    const unix = Math.floor(event.start / 1000);
    await sendWebhook(REMINDER_WEBHOOK_URL, {
      username: "Pokeland Helper Reminders",
      embeds: [{
        color: 16753920,
        title: event.icon + " Reminder: " + event.name,
        description: "Starts in **5 minutes or less**!\n🕒 <t:" + unix + ":F>\n<t:" + unix + ":R>",
        url: WEBSITE_URL,
        footer: { text: "Pokeland Helper · Event reminder · HKT (UTC+8)" }
      }]
    });
    console.log("Reminder sent: " + event.name);
  }
}

async function welcomeTest() {
  if (!WELCOME_WEBHOOK_URL) throw new Error("Missing WELCOME_WEBHOOK_URL GitHub secret.");
  await sendWebhook(WELCOME_WEBHOOK_URL, {
    username: "Pokeland Helper Welcome",
    content: "Welcome to the Pokeland community! 🎮",
    embeds: [{
      color: 5793266,
      title: "✨ Welcome to the Pokeland Crew!",
      description: "Read the rules, meet other trainers, and visit [Pokeland Helper](" + WEBSITE_URL + ") for event schedules and player tools.",
      footer: { text: "Pokeland Helper · Built by players, for players" }
    }]
  });
  console.log("Welcome webhook test sent.");
}

(async () => {
  const mode = process.env.NOTIFY_MODE || "reminder";
  if (mode === "welcome-test") await welcomeTest();
  else await reminderCheck();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
