# Pokeland Helper Assistant

A Discord bot for the Pokeland Helper community.

## Commands

- `/ping` — check whether the bot is online.
- `/ask` — chat with the AI assistant; you can also mention the bot in a server channel.
- `/events` — fetch the upcoming daily/weekly event schedule from the published Pokeland Helper website.
- `/timers` — fetch the website's server reference and calculate upcoming weekly server openings.
- `/help` — show a clean, private command guide and community link.
- `/organize-tips` — server managers can create a Pokeland Knowledge Hub and copy existing posts from a selected forum into topic-based forums. Original posts remain untouched.
- `/serverroles` — admins can publish the server and name-colour reaction-role panels.
- Optional welcome message when a member joins (requires `WELCOME_CHANNEL_ID`).

## Hosting environment variables

Set these in your host's Environment Variables / Secrets section:

- `DISCORD_TOKEN` — bot token from Discord Developer Portal. Keep it secret.
- `CLIENT_ID` — Discord application ID.
- `GUILD_ID` — Discord server ID where commands should be registered.
- `WELCOME_CHANNEL_ID` — optional channel ID for welcome messages.
- `WELCOME_WEBHOOK_URL` — optional Discord webhook URL for automatic welcome messages; takes priority over `WELCOME_CHANNEL_ID`.
- `WELCOME_BANNER_URL` — optional public direct image URL for the welcome embed banner.
- `EVENTS_CHANNEL_ID` — optional channel ID for automatic event reminders (5 minutes before events).
- `REMINDER_WEBHOOK_URL` — optional Discord webhook URL for automatic event reminders; takes priority over `EVENTS_CHANNEL_ID`.
- `SERVER_ROLES_CHANNEL_ID` — optional channel ID for reaction-role panels.
- `POKELAND_WEBSITE_URL` — optional; defaults to `https://pokeland-helper-3sm.pages.dev/`.
- `GROQ_API_KEY` — optional Groq API key; used as the primary AI provider.
- `GEMINI_API_KEY` — optional Google Gemini API key; used if Groq is unavailable or rate-limited.
- `GROQ_MODEL` / `GEMINI_MODEL` — optional model overrides; defaults are `openai/gpt-oss-120b` and `gemini-2.5-flash`.

## How website fetching works

The bot requests the published website when `/events` or `/timers` is used. It reads the site's published event schedule and server-opening reference from the page source and caches the parsed result for 60 seconds. If the page is unavailable or its data format changes, the command reports an error instead of inventing a schedule.

Times are shown in Hong Kong time (HKT, UTC+8), matching the website's server-time convention.

## Discord setup

1. In Discord Developer Portal, enable **Server Members Intent** only if you want welcome messages.
2. Enable the **Message Content Intent** in Discord Developer Portal (Bot → Privileged Gateway Intents) for `@Bot` replies.
3. Give the bot **View Channel** and **Send Messages** permissions in channels where you want it to respond.
4. Start the app using `npm start`.
5. In your server, try `/ping`, `/events`, `/timers`, and `/ask`.

Never commit your bot token to GitHub. Store it only as a secret/environment variable on your hosting provider.
