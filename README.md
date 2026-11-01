# Pokeland Helper Assistant

A Discord bot for the Pokeland Helper community.

## Commands

- `/ping` — check whether the bot is online.
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
- `WELCOME_BANNER_URL` — optional public direct image URL for the welcome embed banner.
- `EVENTS_CHANNEL_ID` — optional channel ID for automatic event reminders (5 minutes before events).
- `SERVER_ROLES_CHANNEL_ID` — optional channel ID for reaction-role panels.
- `POKELAND_WEBSITE_URL` — optional; defaults to `https://pokeland-helper-3sm.pages.dev/`.

## How website fetching works

The bot requests the published website when `/events` or `/timers` is used. It reads the site's published event schedule and server-opening reference from the page source and caches the parsed result for 60 seconds. If the page is unavailable or its data format changes, the command reports an error instead of inventing a schedule.

Times are shown in Hong Kong time (HKT, UTC+8), matching the website's server-time convention.

## Discord setup

1. In Discord Developer Portal, enable **Server Members Intent** only if you want welcome messages.
2. Give the bot **View Channel** and **Send Messages** permissions in channels where you want it to respond.
3. Start the app using `npm start`.
4. In your server, try `/ping`, `/events`, and `/timers`.

Never commit your bot token to GitHub. Store it only as a secret/environment variable on your hosting provider.


## GitHub Actions webhook notifications

The workflow at `.github/workflows/main.yml` checks the published website schedule every five minutes and posts an event reminder through the Reminder Discord webhook when an event is due within five minutes.

Add these repository Actions secrets (never put webhook URLs in source files):

- `REMINDER_WEBHOOK_URL` — the event-reminder channel webhook.
- `WELCOME_WEBHOOK_URL` — the separate welcome-channel webhook, used only by the manual `welcome-test` workflow option.

To run the automatic member welcome, keep Discord's built-in welcome system enabled or run the bot with `WELCOME_CHANNEL_ID`; GitHub Actions cannot detect Discord member-join events by itself. The workflow's welcome option is a manual test message, not an automatic join trigger.

Open **Settings → Secrets and variables → Actions → New repository secret** for each secret. Scheduled GitHub Actions runs are not an always-on bot host and may be delayed by GitHub.
