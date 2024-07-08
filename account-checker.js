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

let deviceStatus;

const checkDevices = (devices) => {
  const currentTime = Date.now();
  const deviceOfflineMaxTime = process.env.DEVICE_OFFLINE_MAX_TIME * 60 * 1000;

  devices.forEach((device) => {
    if (currentTime - device.dateLastMessageReceived > deviceOfflineMaxTime) {
      const embed = new MessageEmbed()
        .setTitle("DEVICES CHECKER:")
        .setColor("#0099ff")
        .setTimestamp();

      embed.setDescription(
        `🔴 Alert: Device ${device.deviceId} has OFFLINE for the last ${process.env.DEVICE_OFFLINE_MAX_TIME} minutes.\n`
      );

      const channel = client.channels.cache.get(process.env.DEVICE_CHANNEL_ID);
      if (channel) {
        channel
          .send(embed)
          .then(() => {
            logMessage("Query results sent successfully.");
          })
          .catch((error) => {
            logMessage(`Error sending the query results: ${error}`);
          });
      } else {
        logMessage("Specified channel not found.");
      }
    }
  });
};

const devicefetch = async () => {
  try {
    const response = await fetch(`${process.env.ROTOM_ENDPOINT}/api/status`);
    const data = await response.json();
    deviceStatus = data;
    checkDevices(data.devices);
  } catch (error) {
    console.error("Error fetching device status:", error);
  }
};

// Function to send account status message
const sendAccountStatusMessage = () => {
  const connection = connectToDatabase();

  connection.connect((err) => {
    if (err) {
      logMessage(`Error connecting to the database: ${err}`);
      setTimeout(sendAccountStatusMessage, 30000); // Try again in 30 seconds
      return;
    }

    // SQL queries to retrieve the required data
    const queryWithoutToken = `
      SELECT SUM(CASE WHEN refresh_token = '' 
      AND auth_banned = 0
      AND NOT banned 
      AND NOT invalid 
      AND warn_expiration < UNIX_TIMESTAMP()
      AND NOT suspended 
      THEN 1 ELSE 0 END) AS without_token FROM account;
    `;
    const queryWithToken = `
      SELECT SUM(CASE WHEN refresh_token != '' 
      AND auth_banned = 0
      AND NOT banned 
      AND NOT invalid 
      AND warn_expiration < UNIX_TIMESTAMP()
      AND NOT suspended 
      THEN 1 ELSE 0 END) AS with_token FROM account;
    `;
    const queryTotalSuccessfulRefreshTokensToday = `
      SELECT COUNT(*) AS total_successful_refresh_tokens_today 
      FROM account 
      WHERE refresh_token != '' 
      AND DATE(FROM_UNIXTIME(last_refreshed)) = CURDATE();
    `;
    const queryUsable30Plus = `
      SELECT SUM(CASE 
          WHEN level >= 30 
            AND NOT banned 
            AND NOT invalid 
            AND warn_expiration < UNIX_TIMESTAMP()
            AND NOT suspended 
            AND ((consecutive_disable_count <= 1 AND UNIX_TIMESTAMP() - 3*86400 > COALESCE(last_disabled, 0))
                  OR (consecutive_disable_count >= 2 AND UNIX_TIMESTAMP() - 30*86400 > COALESCE(last_disabled, 0)))
            AND (last_selected IS NULL OR last_selected < UNIX_TIMESTAMP() - ${process.env.MIN_REUSE_HOURS}*3600)
            AND auth_banned = 0
            AND refresh_token != ''
          THEN 1 ELSE 0
      END) AS usable_30_plus FROM account;
    `;
    const queryUsable0to29 = `
      SELECT SUM(CASE 
          WHEN level < 30 
            AND NOT banned 
            AND NOT invalid 
            AND warn_expiration < UNIX_TIMESTAMP()
            AND NOT suspended 
            AND ((consecutive_disable_count <= 1 AND UNIX_TIMESTAMP() - 3*86400 > COALESCE(last_disabled, 0))
                  OR (consecutive_disable_count >= 2 AND UNIX_TIMESTAMP() - 30*86400 > COALESCE(last_disabled, 0)))
            AND (last_selected IS NULL OR last_selected < UNIX_TIMESTAMP() - ${process.env.MIN_REUSE_HOURS}*3600)
            AND auth_banned = 0
            AND refresh_token != ''
          THEN 1 ELSE 0
      END) AS usable_0_to_29 FROM account;
    `;
    const queryTotalLevel30Plus = `
      SELECT COUNT(*) AS total_level_30_plus FROM account WHERE level >= 30 AND auth_banned = 0;
    `;
    const queryTotalLevel0to29 = `
      SELECT COUNT(*) AS total_level_0_to_29 FROM account WHERE level < 30 AND auth_banned = 0;
    `;
    const queryTotalBannedAccounts = `
      SELECT COUNT(*) AS total_banned_accounts FROM account WHERE banned != 0;
    `;
    const queryTotalInvalidAccounts = `
      SELECT COUNT(*) AS total_invalid_accounts FROM account WHERE invalid != 0;
    `;
    const queryTotalWarnedAccounts = `
      SELECT COUNT(*) AS total_warned_accounts FROM account WHERE warn_expiration > UNIX_TIMESTAMP();
    `;
    const queryTotalAuthBannedAccounts = `
      SELECT COUNT(*) AS total_auth_banned_accounts FROM account WHERE auth_banned != 0;
    `;

    const queryTotalDisabled = `
    SELECT 
    COUNT(*) AS total_disabled_accounts
      FROM 
          account
      WHERE 
          (consecutive_disable_count <= 1 AND UNIX_TIMESTAMP() - 3*86400 < last_disabled) OR
          (consecutive_disable_count >= 2 AND UNIX_TIMESTAMP() - 30*86400 < last_disabled);
    `;

    // Execute the SQL queries
    connection.query(
      queryWithoutToken,
      (errorWithoutToken, resultsWithoutToken) => {
        if (errorWithoutToken) {
          logMessage(
            `Error executing the query for accounts without token: ${errorWithoutToken}`
          );
          connection.end(); // Close the connection even in case of error
          return;
        }

        connection.query(queryWithToken, (errorWithToken, resultsWithToken) => {
          if (errorWithToken) {
            logMessage(
              `Error executing the query for accounts with token: ${errorWithToken}`
            );
            connection.end(); // Close the connection even in case of error
            return;
          }

          connection.query(
            queryTotalSuccessfulRefreshTokensToday,
            (
              errorTotalSuccessfulRefreshTokensToday,
              resultsTotalSuccessfulRefreshTokensToday
            ) => {
              if (errorTotalSuccessfulRefreshTokensToday) {
                logMessage(
                  `Error executing the query for total successful refresh-tokens today: ${errorTotalSuccessfulRefreshTokensToday}`
                );
                connection.end(); // Close the connection even in case of error
                return;
              }

              connection.query(
                queryUsable30Plus,
                (errorUsable30Plus, resultsUsable30Plus) => {
                  if (errorUsable30Plus) {
                    logMessage(
                      `Error executing the query for usable accounts (30+): ${errorUsable30Plus}`
                    );
                    connection.end(); // Close the connection even in case of error
                    return;
                  }

                  connection.query(
                    queryUsable0to29,
                    (errorUsable0to29, resultsUsable0to29) => {
                      if (errorUsable0to29) {
                        logMessage(
                          `Error executing the query for usable accounts (0-29): ${errorUsable_0to29}`
                        );
                        connection.end(); // Close the connection even in case of error
                        return;
                      }

                      connection.query(
                        queryTotalLevel30Plus,
                        (errorTotalLevel30Plus, resultsTotalLevel30Plus) => {
                          if (errorTotalLevel30Plus) {
                            logMessage(
                              `Error executing the query for total level 30+ accounts: ${errorTotalLevel30Plus}`
                            );
                            connection.end(); // Close the connection even in case of error
                            return;
                          }

                          connection.query(
                            queryTotalLevel0to29,
                            (errorTotalLevel0to29, resultsTotalLevel0to29) => {
                              if (errorTotalLevel0to29) {
                                logMessage(
                                  `Error executing the query for total level 0-29 accounts: ${errorTotalLevel0to29}`
                                );
                                connection.end(); // Close the connection even in case of error
                                return;
                              }

                              connection.query(
                                queryTotalBannedAccounts,
                                (
                                  errorTotalBannedAccounts,
                                  resultsTotalBannedAccounts
                                ) => {
                                  if (errorTotalBannedAccounts) {
                                    logMessage(
                                      `Error executing the query for total banned accounts: ${errorTotalBannedAccounts}`
                                    );
                                    connection.end(); // Close the connection even in case of error
                                    return;
                                  }

                                  connection.query(
                                    queryTotalInvalidAccounts,
                                    (
                                      errorTotalInvalidAccounts,
                                      resultsTotalInvalidAccounts
                                    ) => {
                                      if (errorTotalInvalidAccounts) {
                                        logMessage(
                                          `Error executing the query for total invalid accounts: ${errorTotalInvalidAccounts}`
                                        );
                                        connection.end(); // Close the connection even in case of error
                                        return;
                                      }

                                      connection.query(
                                        queryTotalWarnedAccounts,
                                        (
                                          errorTotalWarnedAccounts,
                                          resultsTotalWarnedAccounts
                                        ) => {
                                          if (errorTotalWarnedAccounts) {
                                            logMessage(
                                              `Error executing the query for total warned accounts: ${errorTotalWarnedAccounts}`
                                            );
                                            connection.end(); // Close the connection even in case of error
                                            return;
                                          }

                                          connection.query(
                                            queryTotalAuthBannedAccounts,
                                            (
                                              errorTotalAuthBannedAccounts,
                                              resultsTotalAuthBannedAccounts
                                            ) => {
                                              if (
                                                errorTotalAuthBannedAccounts
                                              ) {
                                                logMessage(
                                                  `Error executing the query for total auth banned accounts: ${errorTotalAuthBannedAccounts}`
                                                );
                                                connection.end(); // Close the connection even in case of error
                                                return;
                                              }

                                              connection.query(
                                                queryTotalDisabled,
                                                (
                                                  errorTotalDisabledAccounts,
                                                  resultsTotalDisabledAccounts
                                                ) => {
                                                  if (
                                                    errorTotalDisabledAccounts
                                                  ) {
                                                    logMessage(
                                                      `Error executing the query for total disabled accounts: ${errorTotalAuthBannedAccounts}`
                                                    );
                                                    connection.end(); // Close the connection even in case of error
                                                    return;
                                                  }

                                                  // Extract relevant information from the query results
                                                  const { without_token } =
                                                    resultsWithoutToken[0];
                                                  const { with_token } =
                                                    resultsWithToken[0];
                                                  const {
                                                    total_successful_refresh_tokens_today,
                                                  } =
                                                    resultsTotalSuccessfulRefreshTokensToday[0];
                                                  const { usable_30_plus } =
                                                    resultsUsable30Plus[0];
                                                  const { usable_0_to_29 } =
                                                    resultsUsable0to29[0];
                                                  const {
                                                    total_level_30_plus,
                                                  } =
                                                    resultsTotalLevel30Plus[0];
                                                  const {
                                                    total_level_0_to_29,
                                                  } = resultsTotalLevel0to29[0];
                                                  const {
                                                    total_banned_accounts,
                                                  } =
                                                    resultsTotalBannedAccounts[0];
                                                  const {
                                                    total_invalid_accounts,
                                                  } =
                                                    resultsTotalInvalidAccounts[0];
                                                  const {
                                                    total_warned_accounts,
                                                  } =
                                                    resultsTotalWarnedAccounts[0];
                                                  const {
                                                    total_auth_banned_accounts,
                                                  } =
                                                    resultsTotalAuthBannedAccounts[0];

                                                  const {
                                                    total_disabled_accounts,
                                                  } =
                                                    resultsTotalDisabledAccounts[0];
                                                  // Create an embed for the message
                                                  const embed =
                                                    new MessageEmbed()
                                                      .setTitle(
                                                        "📊 Accounts Status"
                                                      )
                                                      .setColor("#00FF00") // Green color for positive status
                                                      .setTimestamp();

                                                  // Add fields to the embed with accurate values
                                                  embed.addField(
                                                    "🔴 Valid Accounts without Token",
                                                    without_token.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "🟢 Valid Accounts with Token",
                                                    with_token.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "🔄 Total Successful Refresh-Tokens Today",
                                                    total_successful_refresh_tokens_today.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "🟢 Ready to Use Accounts (Level 30+)",
                                                    `${usable_30_plus}/${total_level_30_plus}`,
                                                    true
                                                  );
                                                  embed.addField(
                                                    "🟢 Ready to Use Accounts (Level 0-29)",
                                                    `${usable_0_to_29}/${total_level_0_to_29}`,
                                                    true
                                                  );
                                                  embed.addField(
                                                    "📈 Total Level 30+ Accounts",
                                                    total_level_30_plus.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "📉 Total Level 0-29 Accounts",
                                                    total_level_0_to_29.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "🚫 Total Banned Accounts",
                                                    total_banned_accounts.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "❌ Total Invalid Accounts",
                                                    total_invalid_accounts.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "⚠️ Total Accounts with Warnings",
                                                    total_warned_accounts.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "🔒 Total Auth Banned Accounts",
                                                    total_auth_banned_accounts.toString(),
                                                    true
                                                  );
                                                  embed.addField(
                                                    "⏰ Disabled Accounts",
                                                    `${total_disabled_accounts}`,
                                                    true
                                                  );

                                                  // Send message to the specific channel
                                                  const channel =
                                                    client.channels.cache.get(
                                                      process.env.CHANNEL_ID
                                                    );
                                                  if (channel) {
                                                    channel
                                                      .send(embed)
                                                      .then(() => {
                                                        logMessage(
                                                          "Account status message sent successfully."
                                                        );
                                                        connection.end(); // Close the connection after success
                                                      })
                                                      .catch((error) => {
                                                        logMessage(
                                                          `Error sending the account status message: ${error}`
                                                        );
                                                        connection.end(); // Close the connection even in case of error
                                                      });
                                                  } else {
                                                    logMessage(
                                                      "Specified channel not found."
                                                    );
                                                    connection.end(); // Close the connection if the channel is not found
                                                  }
                                                }
                                              );
                                            }
                                          );
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      }
    );
  });
};

client.once("ready", () => {
  logMessage("Bot is online!");

  sendAccountStatusMessage();

  devicefetch();

  // Set the interval for sending account messages
  setInterval(sendAccountStatusMessage, process.env.CHECK_INTERVAL * 60 * 1000);

  // Set the interval for sending devices messages
  setInterval(devicefetch, process.env.DEVICE_CHECK_INTERVAL * 60 * 1000);
});

client.on("message", (message) => {
  if (message.content === "$disabled") {
    fetchDisabledAccounts();
  } else if (message.content === "$check") {
    sendAccountStatusMessage();
  }
});

client.login(process.env.DISCORD_TOKEN);
