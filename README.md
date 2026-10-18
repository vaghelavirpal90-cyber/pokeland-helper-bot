# Pokeland Helper Assistant

A Discord bot for the Pokeland Helper community.

## Commands

- `/ping` — check whether the bot is online.
- `/events` — fetch the upcoming daily/weekly event schedule from the published Pokeland Helper website.
- `/timers` — fetch the website's server reference and calculate upcoming weekly server openings.
- Optional welcome message when a member joins (requires `WELCOME_CHANNEL_ID`).

## Hosting environment variables

Set these in your host's Environment Variables / Secrets section:

- `DISCORD_TOKEN` — bot token from Discord Developer Portal. Keep it secret.
- `CLIENT_ID` — Discord application ID.
- `GUILD_ID` — Discord server ID where commands should be registered.
- `WELCOME_CHANNEL_ID` — optional channel ID for welcome messages.
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
