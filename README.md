# Pokeland Helper Assistant

A starter Discord bot with a `/ping` command and an optional welcome message for new members.

## Hosting environment variables

Set these in your host's Environment Variables / Secrets section:

- `DISCORD_TOKEN` — bot token from Discord Developer Portal. Keep it secret.
- `CLIENT_ID` — Discord application ID.
- `GUILD_ID` — Discord server ID where `/ping` should be registered.
- `WELCOME_CHANNEL_ID` — optional channel ID for welcome messages.

## Discord setup

1. In Discord Developer Portal, open your application and go to **Bot**.
2. Enable **Server Members Intent** if you want welcome messages.
3. Give the bot **View Channel** and **Send Messages** in the welcome channel.
4. Start the app using `npm start`.
5. In your server, try `/ping`.

## Important

Never commit your bot token to GitHub. Add it only as a secret/environment variable on your hosting provider.

This starter does not yet fetch data from the Pokeland Helper website or send scheduled game reminders.
