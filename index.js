const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing required environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if Pokeland Helper Assistant is online")
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

client.once("ready", async () => {
  console.log(`Online as ${client.user.tag}`);

  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log("Slash command /ping registered.");
  } catch (error) {
    console.error("Command registration failed:", error.message);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("🏓 Pong! Pokeland Helper Assistant is online.");
  }
});

client.on("guildMemberAdd", async member => {
  if (!welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(welcomeChannelId);
  if (!channel || !channel.isTextBased()) return;

  channel.send(
    `Welcome ${member}! 👋 Welcome to Pokeland Helper! Share your tips, tricks and suggestions with the community.`
  ).catch(error => console.error("Welcome message failed:", error.message));
});

client.login(token).catch(error => {
  console.error("Discord login failed. Check DISCORD_TOKEN:", error.message);
  process.exit(1);
});