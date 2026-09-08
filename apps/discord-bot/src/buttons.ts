/**
 * Button interaction router. `interactionCreate` dispatches every `isButton()`
 * component here; we parse the namespaced customId (see customId.ts) and
 * re-invoke the matching roll, replying with a fresh message that carries its
 * own "Roll again" button so the chain continues indefinitely.
 *
 * Stateless: every button re-rolls from the payload alone, so an old message's
 * button keeps working with no backend. A reply — not an update — keeps each
 * roll in the channel history, matching how a dice bot is expected to behave.
 */

import { MessageFlags } from 'discord-api-types/v10'
import type { CommandButtonInteraction } from './commands/interactions.js'
import { buildTableLookupMessage } from './commands/lookup.js'
import { buildPostedRollMessage, buildRollMessage } from './commands/roll.js'
import { attributeRoll } from './commands/rollAttribution.js'
import type { ContainerData } from './container.js'
import { parseCustomId } from './customId.js'

export async function handleButtonInteraction(
  interaction: CommandButtonInteraction
): Promise<void> {
  const parsed = parseCustomId(interaction.customId)
  if (!parsed) {
    // Not one of our buttons, or a malformed id — nothing we can act on.
    await interaction.reply({
      content: 'This button is no longer supported.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  // Name the roller on the re-roll, same as the slash-command replies. This is
  // the interaction where it matters most: Discord's own "used /su roll" header
  // attributes a component reply far more weakly than a slash command.
  const roller = interaction.user.displayName

  // `post` re-renders a private roll publicly. It replays the ENCODED result
  // rather than rolling again, so what reaches the channel is provably the
  // outcome the player was looking at when they pressed the button.
  if (parsed.action === 'post') {
    const posted = buildPostedRollMessage(parsed.payload, roller)
    if ('error' in posted) {
      await interaction.reply({ content: posted.error, flags: MessageFlags.Ephemeral })
      return
    }
    const { data, ...payload } = posted
    await interaction.reply(payload)
    await attributeRoll(interaction, data, `Rolled on ${data.tableName}`, {
      table: data.tableName,
      posted: true,
    })
    return
  }

  const message =
    parsed.action === 'roll'
      ? buildRollMessage(parsed.payload, roller)
      : buildTableLookupMessage(parsed.payload)

  if ('error' in message) {
    await interaction.reply({ content: message.error, flags: MessageFlags.Ephemeral })
    return
  }

  // `data` rides along on every V2 payload so attributeRoll can rebuild the
  // container; a lookup is not a roll, so its copy is simply unused.
  const { data, ...payload } = message as typeof message & { data?: ContainerData }
  await interaction.reply(payload)

  // A re-roll is a roll. Recording only the slash-command form would mean the
  // Change Log quietly disagreed with the channel about what happened at the
  // table — and "why is my re-roll missing?" is a worse question than any this
  // saves. `lookup` is not a roll and is deliberately excluded.
  if (parsed.action === 'roll' && data !== undefined) {
    await attributeRoll(interaction, data, `Rolled on ${parsed.payload}`, {
      rerolled: parsed.payload,
    })
  }
}
