/**
 * /su — the bot's single top-level command; everything else is a subcommand.
 *
 * Namespacing fixes the collision problem for good: every dice bot on a
 * server registers /roll, so ours competed in the command picker on avatar
 * alone. Typing /su filters the picker to this bot, and every future
 * subcommand (encounter cards, snapshot lookups, …) lands collision-proof
 * with zero naming deliberation.
 *
 * The subcommand option shapes live with their handlers (roll.ts,
 * lookup.ts); this module only composes the builder and dispatches on
 * `getSubcommand()`. Handlers read their options identically under a
 * subcommand, so their logic and tests are untouched.
 */

import { SlashCommandBuilder } from '@discordjs/builders'
import { gamesCommand, meCommand, shelfCommand } from './account.js'
import { crewCommand, sheetCommand } from './crew.js'
import { gameCommand } from './game.js'
import type { CommandAutocompleteInteraction, CommandExecuteInteraction } from './interactions.js'
import { lookupCommand } from './lookup.js'
import { rollCommand } from './roll.js'

export const suCommand = {
  data: new SlashCommandBuilder()
    .setName('su')
    .setDescription('Salvage Union reference tools')
    .addSubcommand((sub) => rollCommand.subcommand(sub))
    .addSubcommand((sub) => lookupCommand.subcommand(sub))
    // In The Union Now (ADR-030 Phase 6). Always registered, never conditional
    // on configuration: a command that vanishes depending on how the bot was
    // deployed is harder to explain than one that answers "not connected".
    .addSubcommand((sub) => meCommand.subcommand(sub))
    .addSubcommand((sub) => gamesCommand.subcommand(sub))
    .addSubcommand((sub) => shelfCommand.subcommand(sub))
    .addSubcommand((sub) => crewCommand.subcommand(sub))
    .addSubcommand((sub) => sheetCommand.subcommand(sub))
    .addSubcommandGroup((group) => gameCommand.group(group)),

  async execute(interaction: CommandExecuteInteraction): Promise<void> {
    // A group is dispatched by its group name; `getSubcommand()` inside one
    // returns the LEAF (`bind`), which would otherwise fall through to the
    // default and throw.
    if (interaction.options.getSubcommandGroup() === 'game') {
      return gameCommand.execute(interaction)
    }

    switch (interaction.options.getSubcommand()) {
      case 'roll':
        return rollCommand.execute(interaction)
      case 'lookup':
        return lookupCommand.execute(interaction)
      case 'me':
        return meCommand.execute(interaction)
      case 'games':
        return gamesCommand.execute(interaction)
      case 'shelf':
        return shelfCommand.execute(interaction)
      case 'crew':
        return crewCommand.execute(interaction)
      case 'sheet':
        return sheetCommand.execute(interaction)
      default:
        // Unreachable while the builder above and this switch agree; loud
        // beats silent if they ever drift.
        throw new Error(`Unknown /su subcommand: ${interaction.options.getSubcommand()}`)
    }
  },

  async autocomplete(interaction: CommandAutocompleteInteraction): Promise<void> {
    if (interaction.options.getSubcommandGroup() === 'game') {
      return gameCommand.autocomplete(interaction)
    }

    switch (interaction.options.getSubcommand()) {
      case 'roll':
        return rollCommand.autocomplete(interaction)
      case 'lookup':
        return lookupCommand.autocomplete(interaction)
      case 'sheet':
        return sheetCommand.autocomplete(interaction)
      default:
        await interaction.respond([])
    }
  },
}
