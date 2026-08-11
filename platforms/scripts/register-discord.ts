import "dotenv/config";
import { discordRegistrationCommands } from "../src/discord-registration.js";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !token) {
  throw new Error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first.");
}

const commandDefinitions = [
  {
    name: "glassbox",
    description: "Audit the reasoning and evidentiary support in an AI answer.",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      { name: "question", description: "The original prompt or question", type: 3, required: true, max_length: 4000 },
      { name: "answer", description: "The AI answer to audit", type: 3, required: true, max_length: 4000 },
      { name: "intents", description: "Optional rules separated by semicolons", type: 3, required: false, max_length: 1000 },
      { name: "public", description: "Share the Trust Card publicly (default: only you)", type: 5, required: false },
    ],
  },
  {
    name: "Analyze with GlassBox",
    type: 3,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

const commands = discordRegistrationCommands(commandDefinitions, guildId);

const base = `https://discord.com/api/v10/applications/${applicationId}`;
const url = guildId ? `${base}/guilds/${guildId}/commands` : `${base}/commands`;
const response = await fetch(url, {
  method: "PUT",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});
if (!response.ok) throw new Error(`Discord registration failed (${response.status}): ${await response.text()}`);
console.log(`Registered ${commands.length} ${guildId ? "guild" : "global"} Discord commands.`);
