// Import necessary modules
const { Collection, ActivityType } = require("discord.js");
const dotenv = require("dotenv");
dotenv.config();
const fs = require("fs");
const path = require("path");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const yaml = require("yaml");
const configFile = fs.readFileSync("./config.yml", "utf8");
const config = yaml.parse(configFile);
const { client, mainDB } = require("./init.js");
const { cleanBlacklist, logError } = require("./utils/mainUtils.js");

const blacklistInterval = config.blacklistCleanup || 120;
// Schedule the blacklist cleanup check every blacklistInterval seconds
setInterval(cleanBlacklist, blacklistInterval * 1000);

module.exports = {
  reloadAllSlashCommands,
};

// Holding commands cooldown data
client.cooldowns = new Collection();

// Reading event files
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// Error handlers

client.on("warn", async (error) => {
  console.log(error);
  await logError("WARN", error);
});

client.on("error", async (error) => {
  console.log(error);
  await logError("ERROR", error);
});

process.on("unhandledRejection", async (error) => {
  console.log(error);
  await logError("unhandledRejection", error);
});

process.on("uncaughtException", async (error) => {
  console.log(error);
  await logError("uncaughtException", error);
});

client.commands = new Collection();
const commands = [];
const commandFolders = fs.readdirSync("./commands");
for (const folder of commandFolders) {
  const commandFiles = fs
    .readdirSync(`./commands/${folder}`)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(`./commands/${folder}/${file}`);
    if (command.enabled) {
      commands.push(command.data.toJSON());
      console.log(`The slash command [${file}] has been loaded!`);
      client.commands.set(command.data.name, command);
    }
  }
}

client.on("ready", async () => {
  try {
    const rest = new REST({
      version: "10",
    }).setToken(process.env.BOT_TOKEN);

    (async () => {
      try {
        // Get the previously registered slash commands
        const registeredCommands = await rest.get(
          Routes.applicationGuildCommands(
            process.env.CLIENT_ID,
            process.env.GUILD_ID,
          ),
        );

        // Filter out the new slash commands that are not already registered
        const newCommands = commands.filter((command) => {
          return !registeredCommands.some((registeredCommand) => {
            return registeredCommand.name === command.name;
          });
        });

        // Filter out the existing slash commands that are not in the new commands
        const removedCommands = registeredCommands.filter(
          (registeredCommand) => {
            return !commands.some((command) => {
              return command.name === registeredCommand.name;
            });
          },
        );

        // Register the new slash commands if there are any
        if (newCommands.length > 0) {
          await rest.put(
            Routes.applicationGuildCommands(
              process.env.CLIENT_ID,
              process.env.GUILD_ID,
            ),
            {
              body: commands,
            },
          );

          console.log("New slash commands registered successfully.");
          console.log(commands.map((command) => command.name));
        } else {
          console.log("No new slash commands to register.");
        }

        // Remove the existing slash commands if there are any
        if (removedCommands.length > 0) {
          await Promise.all(
            removedCommands.map((command) =>
              rest.delete(
                Routes.applicationGuildCommand(
                  process.env.CLIENT_ID,
                  process.env.GUILD_ID,
                  command.id,
                ),
              ),
            ),
          );

          console.log("Existing slash commands removed successfully.");
          console.log(removedCommands.map((command) => command.name));
        } else {
          console.log("No existing slash commands to remove.");
        }
      } catch (error) {
        if (error) {
          error.errorContext = `[Commands Registration Error]: an error occurred during slash command registration`;
          client.emit("error", error);
          console.log(
            `The bot may have been invited with some missing options. Please use the link below to re-invite your bot if that is the case.`,
          );
          console.log(
            `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=268823632&scope=bot%20applications.commands`,
          );
        }
      }
    })();

    const presence = {
      activities: [
        {
          name: config.status.botActivityText || "Support Tickets",
          type: ActivityType[config.status.botActivityType || "Watching"],
        },
      ],
      status: config.status.botStatus || "online",
    };

    if (config.status.botActivityType === "Streaming") {
      presence.activities[0].url = config.status.streamingOptionURL;
    }

    client.user.setPresence(presence);
    const keysToDelete = (await mainDB.startsWith("isClaimInProgress")).map(
      ({ id }) => id,
    );
    await Promise.all(
      keysToDelete.map(async (key) => {
        await mainDB.delete(key);
      }),
    );
    console.log(`The ticket bot is now ready! Logged in as ${client.user.tag}`);
  } catch (error) {
    error.errorContext = `[Ready Event Error]: an error occurred during initialization`;
    client.emit("error", error);
  }
});

// Function to reload all slash commands
async function reloadAllSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID,
    ),
    {
      body: commands,
    },
  );

  console.log(
    "All slash commands have been reloaded! Please use with caution due to rate limits.",
  );
  console.log(commands.map((command) => command.name));
}

// Log in to Discord with your app's token
client.login(process.env.BOT_TOKEN).catch(async (error) => {
  if (error.message.includes("An invalid token was provided")) {
    console.log(error);
    await logError("INVALID_TOKEN", error);
    process.exit();
  } else if (
    error.message.includes(
      "Privileged intent provided is not enabled or whitelisted.",
    )
  ) {
    console.log(error);
    await logError("DISALLOWED_INTENTS", error);
    process.exit();
  } else {
    console.log(error);
    await logError("ERROR", error);
    process.exit();
  }
});
