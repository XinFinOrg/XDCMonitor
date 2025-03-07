# Grafana Alerting Configuration

This directory contains configuration files for Grafana's alerting functionality.

## Security Warning

The configuration files in this directory may contain sensitive information like API tokens and webhook URLs.
**Do not commit files with actual credentials to your Git repository**.

## Setup Instructions

1. Make a copy of the example files:

   ```bash
   cp alertmanager.example.yaml alertmanager.yaml
   cp rules.example.yaml rules.yaml
   ```

2. Update your `.env` file with the actual values for:

   ```
   TELEGRAM_BOT_TOKEN=your-actual-bot-token
   TELEGRAM_CHAT_ID=your-actual-chat-id
   ```

3. Ensure that `.gitignore` excludes the actual configuration files:
   ```
   # In .gitignore
   grafana_data/provisioning/alerting/*.yaml
   !grafana_data/provisioning/alerting/*.example.yaml
   !grafana_data/provisioning/alerting/README.md
   ```

## Setting Up Telegram Bot

1. Create a new bot through [@BotFather](https://t.me/botfather) on Telegram
2. Get the bot token from BotFather
3. Add the bot to your group or channel
4. Get the chat ID (use the [@getidsbot](https://t.me/getidsbot) or other methods)
5. Add these to your `.env` file (not to the configuration files directly)

## Alert Rules

The alert rules are defined in `rules.yaml`. These monitor your system and fire alerts
when conditions are met. Examples include:

- RPC endpoint availability
- Block time monitoring
- Transaction monitoring
- High RPC latency

## Contact Points

Contact points define where alerts are sent. The file `alertmanager.yaml` configures:

- Telegram notifications
- Alert grouping
- Notification timing and frequency
