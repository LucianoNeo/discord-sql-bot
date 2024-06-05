# Discord SQL Bot for Dragonite

This bot periodically checks Dragonite's database for accounts without a refresh token and sends a notification to a specific Discord channel.

## Requirements
- Discord bot configured and added to your discord server with creating messages permissions
- Node.js 18 or higher
- PM2 (Process Manager for Node.js applications)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/LucianoNeo/discord-sql-bot.git

   ```

2. Navigate to the project directory:

   ```bash
    cd discord-sql-bot

   ```

3. Install dependencies:

   ```bash
   npm install

   ```

4. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

- Modify the following environment variables to the .env file:
  ```
  DISCORD_TOKEN=your_discord_bot_token
  DB_HOST=your_mysql_host
  DB_USER=your_mysql_user
  DB_PASSWORD=your_mysql_password
  DB_NAME=your_mysql_database
  DB_PORT=your_mysql_port
  CHANNEL_ID=your_discord_channel_id
  CHECK_INTERVAL=interval_to_receive_the_accounts_status_message
  DEVICE_CHECK_INTERVAL=interval_to_receive_the_devices_status_message
  DEVICE_OFFLINE_MAX_TIME=max_time_in_minutes_to_consider_device_offline
  CHANNEL_ID=account_discordChannelId
  DEVICE_CHANNEL_ID=device_DiscordChannelId
  ROTOM_ENDPOINT=rotom_endpoint
  MIN_REUSE_HOURS=169
  ```
  Replace your_mysql_host, your_mysql_user, your_mysql_password, your_mysql_database, your_mysql_port, your_discord_bot_token, and your_discord_channel_id with your actual MySQL database and Discord bot information. CHECK_INTERVAL is the interval in minutes for the bot to perform the database check.

# Usage
## Node
You can start the bot using npm start:
```bash
npm start
```
This will execute the script specified in the start field of the package.json file, which is node account-checker.js.

After starting the bot with npm start, it will run in the foreground. To stop it, you'll need to terminate the process manually, for example, by pressing Ctrl + C in the terminal where the bot is running.

## PM2
Alternatively, you can also start the bot with PM2, run:

```bash
pm2 start account-checker.js --name account-checker
```

To stop the bot, you can use:
```bash
pm2 stop account-checker
```
And to restart it, you can use:
```bash
pm2 restart account-checker
```

You can check the status of your bot using:
```bash
pm2 status
```

Additionally, you can monitor your bot's logs using:
```bash
pm2 logs account-checker
```

# License 
This project is licensed under the MIT License