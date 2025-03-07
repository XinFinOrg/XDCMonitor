# Security Practices

This document outlines security best practices for this project, especially regarding sensitive credentials and tokens.

## Sensitive Information

This project uses several pieces of sensitive information that should **never** be committed to Git repositories:

1. **Telegram Bot Token**: Used for alerting notifications
2. **Telegram Chat ID**: Identifies where alerts are sent
3. **API Keys and Tokens**: Any other authentication tokens
4. **Database Credentials**: If using external databases

## Safe Practices

### Environment Variables

- Always use `.env` files for sensitive information
- Never commit the actual `.env` file to Git
- Provide an `.env.example` file with dummy values as a template

### Configuration Files

- For configs that might contain sensitive data (like alerting configs), use template files
- Name template files with `.example` suffix (e.g., `alertmanager.example.yaml`)
- Ensure your `.gitignore` excludes real config files but includes examples

### Git Safety

Before pushing to remote repositories:

1. Check for sensitive information in your changes:

   ```bash
   git diff --staged
   ```

2. Use tools like `git-secrets` to prevent accidental commits of sensitive information

3. If you accidentally commit sensitive information:
   - Change the credentials immediately
   - Use Git tools to remove the sensitive data from history (e.g., `git filter-branch`)

## Setup for New Developers

1. Clone the repository
2. Copy example files:
   ```bash
   cp .env.example .env
   cp grafana_data/provisioning/alerting/alertmanager.example.yaml grafana_data/provisioning/alerting/alertmanager.yaml
   cp grafana_data/provisioning/alerting/rules.example.yaml grafana_data/provisioning/alerting/rules.yaml
   ```
3. Fill in your actual credentials in the `.env` file
4. Do NOT commit your changes to the configuration files

## Credential Rotation

Regularly rotate credentials, especially if:

- Someone leaves the development team
- You suspect a credential has been compromised
- It has been a long time since the last rotation
