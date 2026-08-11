type DiscordCommand = Record<string, unknown>;

/** Discord only accepts installation and interaction contexts on global commands. */
export function discordRegistrationCommands(
  definitions: DiscordCommand[],
  guildId?: string,
): DiscordCommand[] {
  if (!guildId) return definitions;
  return definitions.map(({ integration_types: _integrationTypes, contexts: _contexts, ...command }) => command);
}
