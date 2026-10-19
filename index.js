const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
const welcomeBannerUrl = process.env.WELCOME_BANNER_URL || "";
const eventsChannelId = process.env.EVENTS_CHANNEL_ID;
const serverRolesChannelId = process.env.SERVER_ROLES_CHANNEL_ID || "1551503585496399872";
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
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
    .setName("testvit")
    .setDescription("Test all 3 Vit Gift + World Boss reminder banners"),
  new SlashCommandBuilder()
    .setName("testworldboss")
    .setDescription("Test World Boss reminder banner only"),
  new SlashCommandBuilder()
    .setName("testwelcome")
    .setDescription("Preview the welcome message in the welcome channel"),
  new SlashCommandBuilder()
    .setName("serverroles")
    .setDescription("Post the Pokeland server and name-colour role picker")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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


function getEventBanner(eventId) {
  const base = "https://raw.githubusercontent.com/vaghelavirpal90-cyber/pokeland-helper-bot/main/assets/";
  if (eventId === "vit1") return base + "grok_1792392647477.jpg";  // 12:00–14:00 Noon
  if (eventId === "vit2") return base + "grok_1792392650336.jpg";  // 18:00–20:00 Evening
  if (eventId === "vit3") return base + "grok_1792392653758.jpg";  // 21:00–22:00 Night
  if (eventId === "wb")   return base + "world-boss-banner.jpg";   // World Boss 20:00–20:30
  return null;
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

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(event.icon + " Reminder: " + event.name)
        .setDescription("Starts in **5 minutes**!\n🕒 " + formatHkt(new Date(event.start)) + "\n<t:" + Math.floor(event.start / 1000) + ":R>")
        .setURL(WEBSITE_URL)
        .setFooter({ text: "Pokeland Helper · Event reminder · HKT (UTC+8)" });

      // Vit Gift banners (time-based Pikachu images)
      const banner = getEventBanner(event.id);
      if (banner) embed.setImage(banner);

      await channel.send({ embeds: [embed] });
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
    console.log("Slash commands registered, including /serverroles.");
    console.log("Starting automatic event reminders (5 minutes before each event).");
    await checkAutomaticReminders();
    setInterval(checkAutomaticReminders, REMINDER_CHECK_MS);
  } catch (error) {
    console.error("Command registration failed:", error.message);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "serverroles") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Only server managers can post the reaction-role panels.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = await client.channels.fetch(serverRolesChannelId);
      if (!channel || !channel.isTextBased() || !channel.isSendable()) {
        return interaction.editReply("❌ I can't send to the role channel. Check channel ID and View Channel, Send Messages, Embed Links, and Add Reactions permissions.");
      }
      const serverEmojis = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🇦","🇧","🇨","🇩","🇪","🇫","🇬","🇭"];
      const serverMessage = await channel.send({ embeds: [new EmbedBuilder()
        .setColor(0x42c5f5)
        .setTitle("🛰️ SERVER PLAYER ROLES")
        .setDescription("React with the matching number or letter below. Choosing another server replaces your previous Server Player role.")
        .setImage("https://raw.githubusercontent.com/vaghelavirpal90-cyber/pokeland-helper-bot/main/assets/1792341980627.png")
        .setFooter({ text: "Pokeland Helper • React to choose your server" })] });
      for (const emoji of serverEmojis) await serverMessage.react(emoji);

      const colours = [
        ["👑","Royal Gold",0xf1c40f],["🧊","Ice Blue",0x70d6ff],["💜","Amethyst",0x9b59b6],
        ["❤️","Crimson Red",0xe74c3c],["💚","Emerald Green",0x2ecc71],["🌸","Rose Pink",0xff69b4],
        ["🌊","Ocean Blue",0x168aad],["🔮","Neon Purple",0x8a2be2],["🌅","Sunset Orange",0xff7f27],
        ["⚪","Silver",0xbdc3c7],["🍃","Mint",0x98ff98],["🪻","Lavender",0xc8a2c8],
        ["♦️","Ruby",0xaa0000],["🔷","Sapphire",0x0f52ba],["⚡","Neon Green",0x39ff14],
        ["🤍","Pearl White",0xffffff],["🌌","Midnight Navy",0x191970],["🟤","Copper",0xb87333],
        ["🩵","Teal",0x008080],["🪸","Coral",0xff7f50]
      ];
      const colourMessage = await channel.send({ embeds: [new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🎨 NAME COLOUR")
        .setDescription("React with one colour emoji below. Change it anytime; your server role stays the same.")
        .setImage("https://raw.githubusercontent.com/vaghelavirpal90-cyber/pokeland-helper-bot/main/assets/1792341741762.png")
        .setFooter({ text: "Pokeland Helper • React to choose your name colour" })] });
      for (const [emoji] of colours) await colourMessage.react(emoji);
      return interaction.editReply(`✅ Reaction role panels posted in <#${serverRolesChannelId}>.`);
    } catch (error) {
      console.error("/serverroles failed:", error.stack || error.message);
      return interaction.editReply("❌ Couldn't post the reaction panels. Check Console for the exact error and make sure the bot can send messages, embed links, and add reactions in the channel.");
    }
  }

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

  if (interaction.commandName === "testvit") {
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

      const tests = [
        { id: "vit1", name: "Vit Gift (Noon)", icon: "⚡", time: "12:00–14:00" },
        { id: "vit2", name: "Vit Gift (Evening)", icon: "⚡", time: "18:00–20:00" },
        { id: "vit3", name: "Vit Gift (Night)", icon: "⚡", time: "21:00–22:00" },
        { id: "wb", name: "World Boss", icon: "🐉", time: "20:00–20:30" }
      ];

      for (const t of tests) {
        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle(t.icon + " Reminder: " + t.name)
          .setDescription("Starts in **5 minutes**!\n🕒 Test · " + t.time + " HKT\n<t:" + Math.floor(Date.now() / 1000 + 300) + ":R>")
          .setURL(WEBSITE_URL)
          .setFooter({ text: "Pokeland Helper · TEST Event banner · HKT (UTC+8)" });

        const banner = getEventBanner(t.id);
        if (banner) embed.setImage(banner);

        await channel.send({ embeds: [embed] });
      }

      await interaction.editReply("✅ 4 test banners sent (3 Vit Gift + World Boss) to <#" + eventsChannelId + ">.");
    } catch (error) {
      console.error("/testvit failed:", error.message);
      await interaction.editReply("❌ Couldn't send the test banners. Check permissions.");
    }
    return;
  }

  if (interaction.commandName === "testworldboss") {
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
        await interaction.editReply("I can't send messages to the configured events channel.");
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🐉 Reminder: World Boss")
        .setDescription("Starts in **5 minutes**!\n🕒 Test · 20:00–20:30 HKT\n<t:" + Math.floor(Date.now() / 1000 + 300) + ":R>")
        .setURL(WEBSITE_URL)
        .setFooter({ text: "Pokeland Helper · TEST World Boss banner · HKT (UTC+8)" });

      const banner = getEventBanner("wb");
      if (banner) embed.setImage(banner);

      await channel.send({ embeds: [embed] });
      await interaction.editReply("✅ World Boss test banner sent to <#" + eventsChannelId + ">.");
    } catch (error) {
      console.error("/testworldboss failed:", error.message);
      await interaction.editReply("❌ Couldn't send the World Boss test banner.");
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

client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message;
    if (!message.guild || message.channel.id !== serverRolesChannelId) return;
    const title = message.embeds?.[0]?.title || "";
    const emoji = reaction.emoji.name;
    const guild = message.guild;
    const member = await guild.members.fetch(user.id);

    if (title === "🛰️ SERVER PLAYER ROLES") {
      const serverEmojis = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🇦","🇧","🇨","🇩","🇪","🇫","🇬","🇭"];
      const index = serverEmojis.indexOf(emoji);
      if (index < 0) return;
      const number = 1100 + index;
      const roleName = `S${number} • Server Player`;
      let role = guild.roles.cache.find(item => item.name === roleName);
      if (!role) role = await guild.roles.create({ name: roleName, color: 0x42c5f5, reason: "Reaction role selection" });
      const oldRoles = member.roles.cache.filter(item => /^S\d+ • Server Player$/.test(item.name));
      if (oldRoles.size) await member.roles.remove(oldRoles, "Member selected a different server");
      await member.roles.add(role, "Member selected server by reaction");
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    if (title === "🎨 NAME COLOUR") {
      const colours = [
        ["👑","Royal Gold",0xf1c40f],["🧊","Ice Blue",0x70d6ff],["💜","Amethyst",0x9b59b6],
        ["❤️","Crimson Red",0xe74c3c],["💚","Emerald Green",0x2ecc71],["🌸","Rose Pink",0xff69b4],
        ["🌊","Ocean Blue",0x168aad],["🔮","Neon Purple",0x8a2be2],["🌅","Sunset Orange",0xff7f27],
        ["⚪","Silver",0xbdc3c7],["🍃","Mint",0x98ff98],["🪻","Lavender",0xc8a2c8],
        ["♦️","Ruby",0xaa0000],["🔷","Sapphire",0x0f52ba],["⚡","Neon Green",0x39ff14],
        ["🤍","Pearl White",0xffffff],["🌌","Midnight Navy",0x191970],["🟤","Copper",0xb87333],
        ["🩵","Teal",0x008080],["🪸","Coral",0xff7f50]
      ];
      const selected = colours.find(item => item[0] === emoji);
      if (!selected) return;
      const roleName = selected[1];
      let role = guild.roles.cache.find(item => item.name === roleName);
      if (!role) role = await guild.roles.create({ name: roleName, color: selected[2], reason: "Reaction colour role selection" });
      const colourNames = colours.map(item => item[1]);
      const oldRoles = member.roles.cache.filter(item => colourNames.includes(item.name) && item.id !== role.id);
      if (oldRoles.size) await member.roles.remove(oldRoles, "Member changed name colour");
      await member.roles.add(role, "Member selected name colour by reaction");
      await reaction.users.remove(user.id).catch(() => {});
    }
  } catch (error) {
    console.error("Reaction role assignment failed:", error.stack || error.message);
  }
});

function makeWelcomeEmbed(user, guild) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: "POKELAND HELPER  •  COMMUNITY",
      iconURL: client.user?.displayAvatarURL({ size: 128 })
    })
    .setTitle("✨ Welcome to the Pokeland Crew!")
    .setDescription(
      "Welcome " + user + " to **" + (guild?.name || "our community") + "**! 🎮\n\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "⚔️ **YOUR ADVENTURE STARTS HERE**\n\n" +
      "📜 **Read the rules** to get started.\n" +
      "💡 **Share your knowledge** — builds, tips, tricks, and suggestions are always welcome.\n" +
      "📢 **Stay updated** with community announcements.\n" +
      "🌐 **[Open Pokeland Helper](" + WEBSITE_URL + ")** for event schedules and player tools.\n\n" +
      "Make friends, help other trainers, and enjoy the game. **Welcome aboard!** 💙"
    )
    .setThumbnail(client.user?.displayAvatarURL({ size: 256 }))
    .setFooter({ text: "POKELAND HELPER  •  Built by players, for players" })
    .setTimestamp();

  // Optional wide banner: set WELCOME_BANNER_URL to a publicly accessible direct image URL.
  if (welcomeBannerUrl) embed.setImage(welcomeBannerUrl);
  return embed;
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
