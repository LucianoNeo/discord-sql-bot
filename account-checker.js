require("dotenv").config();
const { Client, MessageEmbed } = require("discord.js");
const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");

const LOG_FILE_PATH = path.join(__dirname, "log.txt");
const MAX_LOG_SIZE = 1 * 1024 * 1024; // 1MB

// Configure Discord client
const client = new Client();

// Function to connect to the database
const connectToDatabase = () => {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
  });
};

// Function to recycle the log file if necessary
const recycleLogFile = () => {
  if (fs.existsSync(LOG_FILE_PATH)) {
    const stats = fs.statSync(LOG_FILE_PATH);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const newLogFilePath = path.join(__dirname, `log-${timestamp}.txt`);
      fs.renameSync(LOG_FILE_PATH, newLogFilePath);
    }
  }
};

// Function to log messages in console and file
const logMessage = (message) => {
  const timestamp = new Date().toLocaleString();
  const log = `[${timestamp}] ${message}\n`;
  console.log(log);

  recycleLogFile();

  fs.appendFileSync(LOG_FILE_PATH, log);
};

client.once("ready", () => {
  logMessage("Bot is online!");

  const sendMessage = () => {
    const connection = connectToDatabase();

    connection.connect((err) => {
      if (err) {
        logMessage(`Error connecting to the database: ${err}`);
        setTimeout(sendMessage, 30000); // Try again in 30 seconds
        return;
      }

      // Perform database queries
      const noTokenQuery = `SELECT COUNT(*) FROM account WHERE refresh_token = ''`; // Adjust the query as necessary
      const readyToUseQuery = `SELECT
                                  SUM(
                                      CASE
                                      WHEN
                                          not banned
                                          AND not invalid
                                          AND warn_expiration < UNIX_TIMESTAMP()
                                          AND not suspended
                                          AND (
                                              (
                                                  consecutive_disable_count <= 1
                                                  AND UNIX_TIMESTAMP() - 345600 > coalesce(last_disabled, 0)))
                                          AND level >= 30
                                          AND refresh_token <> ''
                                      THEN
                                          1
                                      ELSE
                                          0
                                      END
                                  ) AS Total
                              FROM
                                  account;`;

      connection.query(noTokenQuery, (error, noTokensAccs) => {
        if (error) {
          logMessage(`Error executing the noTokenQuery: ${error}`);
          connection.end(); // Close the connection even in case of error
          return;
        }

        const noTokensAccsCount = noTokensAccs[0]["COUNT(*)"];

        connection.query(readyToUseQuery, (error, readyToUseAccs) => {
          if (error) {
            logMessage(`Error executing the readyToUseQuery: ${error}`);
            connection.end(); // Close the connection even in case of error
            return;
          }

          const readyToUseAccsCount = readyToUseAccs[0]["Total"];

          // Create embed for the message
          const embed = new MessageEmbed()
            .setTitle("ACCOUNTS CHECKER:")
            .setColor("#0099ff")
            .setTimestamp();

          // Check for noTokensAccs
          if (noTokensAccsCount > 0) {
            embed.setDescription(
              `There are ${noTokensAccsCount} accounts without token 🔴\n`
            );
          } else {
            embed.setDescription("No accounts without token. 🟢\n");
          }
          if (readyToUseAccs > 5) {
            embed.addField(
              "🟢 Ready to Use Accounts",
              `${readyToUseAccsCount} accounts are ready to use`
            );
          } else {
            embed.addField(
              "🔴 Ready to Use Accounts (WARNING)",
              `${readyToUseAccsCount} accounts are ready to use`
            );
          }

          // Send message to the specific channel
          const channel = client.channels.cache.get(process.env.CHANNEL_ID);
          if (channel) {
            channel
              .send(embed)
              .then(() => {
                logMessage("Query results sent successfully.");
                connection.end(); // Close the connection after success
              })
              .catch((error) => {
                logMessage(`Error sending the query results: ${error}`);
                connection.end(); // Close the connection even in case of error
              });
          } else {
            logMessage("Specified channel not found.");
            connection.end(); // Close the connection if the channel is not found
          }
        });
      });
    });
  };

  // Send the message immediately on startup
  sendMessage();

  // Set the interval for sending messages
  setInterval(sendMessage, process.env.CHECK_INTERVAL * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
