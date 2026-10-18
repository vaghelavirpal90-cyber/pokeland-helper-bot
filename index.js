const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
const eventsChannelId = process.env.EVENTS_CHANNEL_ID;
const WEBSITE_URL = process.env.POKELAND_WEBSITE_URL || "https://pokeland-helper-3sm.pages.dev/";
const HKT = "Asia/Hong_Kong";
const REMINDER_CHECK_MS = 30000;
const REMINDER_LEAD_MS = 5 * 60 * 1000;
const sentReminderKeys = new Set();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const CACHE_MS = 60 * 1000;

if (!token || !clientId || !guildId) {
  console.error("Missing required environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if Pokeland Helper Assistant is online"),
  new SlashCommandBuilder()
    .setName("events")
    .setDescription("Fetch upcoming events from the Pokeland Helper website"),
  new SlashCommandBuilder()
    .setName("timers")
    .setDescription("Show the next server-opening timers from Pokeland Helper"),
  new SlashCommandBuilder()
    .setName("testreminder")
    .setDescription("Send a test event reminder to the events channel"),
  new SlashCommandBuilder()
    .setName("testwelcome")
    .setDescription("Preview the welcome message in the welcome channel")
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);
let scheduleCache = null;
let scheduleCacheAt = 0;


function hktParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HKT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const result = {};
  for (const part of parts) if (part.type !== "literal") result[part.type] = Number(part.value);
  return result;
}

function formatHkt(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: HKT,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date) + " HKT";
}

function countdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${minutes}m ${seconds}s`;
}

function parseDateUtcCall(html) {
  const match = html.match(/const\s+REF_TIME\s*=\s*Date\.UTC\(([^)]*)\)\s*;/);
  if (!match) throw new Error("The website's server timer reference was not found.");
  const args = match[1].split(",").map(value => Number(value.trim()));
  if (args.length < 3 || args.some(value => !Number.isFinite(value))) {
    throw new Error("The website's server timer reference could not be parsed.");
  }
  return Date.UTC(...args);
}

function parseWebsiteSchedule(html) {
  const eventBlock = html.match(/const\s+DAILY_EVENTS\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!eventBlock) throw new Error("The website's event schedule was not found.");

  const eventPattern = /\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*icon:\s*'([^']*)'\s*,\s*desc:\s*'([^']*)'\s*,\s*h:\s*(\d+)\s*,\s*m:\s*(\d+)\s*,\s*dur:\s*(\d+)\s*,\s*dow:\s*(null|\d+)\s*\}/g;
  const events = [];
  let match;
  while ((match = eventPattern.exec(eventBlock[1])) !== null) {
    events.push({
      id: match[1],
      name: match[2],
      icon: match[3] || "📅",
      description: match[4],
      hour: Number(match[5]),
      minute: Number(match[6]),
      durationMinutes: Number(match[7]),
      dayOfWeek: match[8] === "null" ? null : Number(match[8])
    });
  }
  if (events.length === 0) throw new Error("The website schedule format changed; no events could be read.");

  const serverMatch = html.match(/const\s+REF_SERVER\s*=\s*(\d+)\s*;/);
  if (!serverMatch) throw new Error("The website's server number was not found.");
  const referenceTime = parseDateUtcCall(html);

  return {
    events,
    referenceServer: Number(serverMatch[1]),
    referenceTime,
    sourceUrl: WEBSITE_URL,
    fetchedAt: Date.now()
  };
}

async function fetchWebsiteSchedule() {
  if (scheduleCache && Date.now() - scheduleCacheAt < CACHE_MS) return scheduleCache;

  const response = await fetch(WEBSITE_URL, {
    headers: { "User-Agent": "PokelandHelperDiscordBot/1.0 (+website schedule reader)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
  const html = await response.text();
  const data = parseWebsiteSchedule(html);
  scheduleCache = data;
  scheduleCacheAt = Date.now();
  console.log(`Website schedule synced: ${data.events.length} events; server reference #${data.referenceServer}.`);
  return data;
}

function eventOccurrences(events, now, limit = 10) {
  const current = hktParts(now);
  const candidates = [];

  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(current.year, current.month - 1, current.day + offset));
    const dow = day.getUTCDay();
    for (const event of events) {
      if (event.dayOfWeek !== null && event.dayOfWeek !== dow) continue;
      const start = Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        event.hour - 8,
        event.minute,
        0,
        0
      );
      const end = start + event.durationMinutes * 60 * 1000;
      if (end <= now.getTime()) continue;
      candidates.push({ ...event, start, end, live: start <= now.getTime() });
    }
  }

  candidates.sort((a, b) => a.start - b.start);
  return candidates.slice(0, limit);
}


async function checkAutomaticReminders() {
  if (!eventsChannelId) {
    console.warn("Set EVENTS_CHANNEL_ID in hosting variables to enable automatic event reminders.");
    return;
  }
  try {
    const channel = await client.channels.fetch(eventsChannelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
      console.error("EVENTS_CHANNEL_ID is not a sendable text channel.");
      return;
    }
    const now = Date.now();
    const data = await fetchWebsiteSchedule();
    const upcoming = eventOccurrences(data.events, new Date(now), 50);
    for (const event of upcoming) {
      const remaining = event.start - now;
      if (remaining > REMINDER_LEAD_MS || remaining <= REMINDER_LEAD_MS - REMINDER_CHECK_MS) continue;
      const key = event.id + ":" + event.start;
      if (sentReminderKeys.has(key)) continue;
      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle(event.icon + " Reminder: " + event.name)
          .setDescription("Starts in **5 minutes**!\n🕒 " + formatHkt(new Date(event.start)) + "\n<t:" + Math.floor(event.start / 1000) + ":R>")
          .setURL(WEBSITE_URL)
          .setFooter({ text: "Pokeland Helper · Event reminder · HKT (UTC+8)" })]
      });
      sentReminderKeys.add(key);
      console.log("Automatic reminder sent: " + event.name);
    }
    for (const key of sentReminderKeys) {
      const timestamp = Number(key.split(":").pop());
      if (timestamp < now - 86400000) sentReminderKeys.delete(key);
    }
  } catch (error) {
    console.error("Automatic reminder check failed:", error.message);
  }
}

function nextServer(data, nowMs, offset = 0) {
  let target = data.referenceTime;
  let number = data.referenceServer;
  while (target <= nowMs) {
    target += WEEK_MS;
    number++;
  }
  target += offset * WEEK_MS;
  number += offset;
  return { number, target };
}

client.once("ready", async () => {
  console.log(`Online as ${client.user.tag}`);
  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log("Slash commands registered: /ping, /events, /timers, /testreminder, /testwelcome.");
    console.log("Starting automatic event reminders (5 minutes before each event).");
    await checkAutomaticReminders();
    setInterval(checkAutomaticReminders, REMINDER_CHECK_MS);
  } catch (error) {
    console.error("Command registration failed:", error.message);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("🏓 Pong! Pokeland Helper Assistant is online.");
    return;
  }

  if (interaction.commandName === "testreminder") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Only server managers can run this test.", ephemeral: true });
      return;
    }
    if (!eventsChannelId) {
      await interaction.reply({ content: "EVENTS_CHANNEL_ID is missing in hosting Variables.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = await client.channels.fetch(eventsChannelId);
      if (!channel || !channel.isTextBased() || !channel.isSendable()) {
        await interaction.editReply("I can't send messages to the configured events channel. Check the channel ID and bot permissions.");
        return;
      }
      const now = new Date();
      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🧪 Test Reminder — Pokeland Helper")
        .setDescription("This is a **test message**, not a real event alert.\n\n✅ The bot can send messages to the events channel.\n⏰ Real reminders are sent about 5 minutes before scheduled events.")
        .setURL(WEBSITE_URL)
        .setFooter({ text: "Pokeland Helper · Test only · HKT (UTC+8)" })
        .setTimestamp(now);
      await channel.send({ embeds: [embed] });
      await interaction.editReply("✅ Test reminder sent to <#" + eventsChannelId + ">.");
    } catch (error) {
      console.error("/testreminder failed:", error.message);
      await interaction.editReply("❌ Couldn't send the test reminder. Check the bot's View Channel and Send Messages permissions.");
    }
    return;
  }

  if (interaction.commandName === "testwelcome") {
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Only server managers can run this test.", ephemeral: true });
      return;
    }
    if (!welcomeChannelId) {
      await interaction.reply({ content: "WELCOME_CHANNEL_ID is missing in hosting Variables. Set it to the ID of your 👋・welcome channel.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = await client.channels.fetch(welcomeChannelId);
      if (!channel || !channel.isTextBased() || !channel.isSendable()) {
        await interaction.editReply("I can't send messages to the configured welcome channel. Check its ID and bot permissions.");
        return;
      }
      await channel.send({ embeds: [makeWelcomeEmbed(interaction.user, interaction.guild)] });
      await interaction.editReply("✅ Welcome preview sent to <#" + welcomeChannelId + ">.");
    } catch (error) {
      console.error("/testwelcome failed:", error.message);
      await interaction.editReply("❌ Couldn't send the welcome preview. Check the bot's View Channel and Send Messages permissions.");
    }
    return;
  }

  if (interaction.commandName === "events") {
    await interaction.deferReply();
    try {
      const data = await fetchWebsiteSchedule();
      const now = new Date();
      const events = eventOccurrences(data.events, now, 10);
      const embed = new EmbedBuilder()
        .setColor(0xef6a2b)
        .setTitle("📅 Pokeland Helper — Upcoming Events")
        .setURL(WEBSITE_URL)
        .setDescription(events.length
          ? events.map(event => {
              const status = event.live
                ? `🟢 **LIVE** · ends ${countdown(event.end - now.getTime())}`
                : `⏳ Starts <t:${Math.floor(event.start / 1000)}:R>`;
              return `${event.icon} **${event.name}**\n${status}\n🕒 ${formatHkt(new Date(event.start))}`;
            }).join("\n\n")
          : "No upcoming events were found in the website schedule.")
        .setFooter({ text: "Times shown in Hong Kong time (HKT) · Source: Pokeland Helper website" })
        .setTimestamp(now);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("/events failed:", error.message);
      await interaction.editReply(
        `I couldn't read the live schedule from the website right now. Please try again shortly: ${WEBSITE_URL}`
      );
    }
    return;
  }

  if (interaction.commandName === "timers") {
    await interaction.deferReply();
    try {
      const data = await fetchWebsiteSchedule();
      const now = Date.now();
      const upcoming = Array.from({ length: 5 }, (_, index) => nextServer(data, now, index));
      const first = upcoming[0];
      const embed = new EmbedBuilder()
        .setColor(0x4fd69c)
        .setTitle("🛰️ Pokeland Helper — Server Timers")
        .setURL(WEBSITE_URL)
        .setDescription(
          `**Next server: #${first.number}**\nOpens ${formatHkt(new Date(first.target))}\n⏳ In ${countdown(first.target - now)} · <t:${Math.floor(first.target / 1000)}:R>\n\n**Upcoming openings**\n` +
          upcoming.map(server => `• **#${server.number}** — ${formatHkt(new Date(server.target))} · <t:${Math.floor(server.target / 1000)}:R>`).join("\n")
        )
        .setFooter({ text: "Uses the server reference published by Pokeland Helper · HKT (UTC+8)" })
        .setTimestamp(new Date());
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("/timers failed:", error.message);
      await interaction.editReply(
        `I couldn't read the server timer from the website right now. Please try again shortly: ${WEBSITE_URL}`
      );
    }
  }
});

function makeWelcomeEmbed(user, guild) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎉 Welcome to Pokeland Helper!")
    .setDescription(
      "Hey " + user + ", welcome to **" + (guild?.name || "our community") + "**! 👋\n\n" +
      "⚔️ **Your Pokeland journey starts here.**\n" +
      "• 📢 Check the announcements channel for news and updates.\n" +
      "• 📜 Read the server rules before chatting.\n" +
      "• 💡 Share your builds, tips, tricks, and suggestions with other players.\n" +
      "• 🌐 Open the [Pokeland Helper website](" + WEBSITE_URL + ") for event schedules and tools.\n\n" +
      "**Have fun and enjoy Pokeland!** 🎮💙"
    )
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: "Pokeland Helper · Built for the community" })
    .setTimestamp();
}

client.on("guildMemberAdd", async member => {
  if (!welcomeChannelId) {
    console.warn("WELCOME_CHANNEL_ID is not set; automatic welcome messages are disabled.");
    return;
  }
  try {
    const channel = await client.channels.fetch(welcomeChannelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
      console.error("WELCOME_CHANNEL_ID is not a sendable text channel.");
      return;
    }
    await channel.send({ content: member.toString(), embeds: [makeWelcomeEmbed(member.user, member.guild)] });
    console.log("Welcome message sent for " + member.user.tag);
  } catch (error) {
    console.error("Welcome message failed:", error.message);
  }
});

client.login(token).catch(error => {
  console.error("Discord login failed. Check DISCORD_TOKEN:", error.message);
  process.exit(1);
});
