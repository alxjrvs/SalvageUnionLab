import type { InteractionEditReplyOptions } from 'discord.js'
import { MessageFlags } from 'discord-api-types/v10'
import type { ContainerData } from '../container.js'
import { toContainer } from '../container.js'
import { report } from '../report.js'
import { itun } from './itunReply.js'

/**
 * Recording a Discord roll against the bound Game (ADR-030 Phase 6).
 *
 * This is issue #623's exit criterion — *"a roll in Discord appears on the
 * table's Dashboard, attributed to the right player"* — and it is deliberately
 * **not a command**. `/su roll` gains no option and no flag for it; in
 * a bound channel their footer simply grows ` · recorded to Tenacity`. A
 * separate `/su gameroll` would be a worse product and a second thing to teach.
 *
 * ## Why the reply is not deferred
 *
 * A dice bot must feel instant, and the reference commands have to behave
 * identically whether or not accounts exist. So the roll is replied to first,
 * exactly as it always was, and the recording happens afterwards — editing the
 * footer only once it has actually landed. A slow or dead deployment therefore
 * costs a rolling player nothing at all, which is the property that matters:
 * the reference bot is the thing people already use.
 *
 * ## Why this rebuilds rather than edits
 *
 * This used to re-stamp the sent embed's footer — `embed.setFooter(…)` then
 * `editReply({ embeds })`. A Components V2 message has no embed and no footer,
 * so there is nothing to mutate: the container is rebuilt from the same pure
 * data with one more block, and the whole message is replaced.
 *
 * That is a better shape than the one it replaces. The signal used to be
 * appended to `ROLL_EMBED_FOOTER`, which buried a real, personal game fact
 * inside attribution boilerplate — in the smallest text on the message, and the
 * first thing to truncate on mobile. It is now its own line.
 *
 * Two properties are preserved deliberately: the line is appended at the
 * **end**, so nothing the player is already reading reflows; and the edit
 * carries `components` and the V2 flag together, because a message created with
 * the flag must keep it.
 *
 * ## Why failure is silent
 *
 * `resolveActor` cannot distinguish "no account", "not bound" and "not a
 * member" *to the channel* without announcing who has an account. For a roll
 * nobody asked to have recorded, the honest response to all three is to say
 * nothing: the roll still rolled. Commands the user explicitly invoked
 * (`/su crew`) explain themselves ephemerally instead — see `itunReply.ts`.
 */

/** The minimum an interaction must offer to attribute a roll from it. */
export type AttributableInteraction = {
  user: { id: string }
  channelId: string | null
  editReply(payload: InteractionEditReplyOptions): Promise<unknown>
}

/**
 * Record a roll, and on success rebuild the container with a line saying so.
 *
 * Never throws and never rejects: it is called after the user already has their
 * roll, so there is no failure here worth surfacing to them. A genuine fault
 * still reaches Sentry.
 */
export async function attributeRoll(
  interaction: AttributableInteraction,
  data: ContainerData,
  description: string,
  result: unknown
): Promise<void> {
  const channelId = interaction.channelId
  const client = itun()
  if (client === null || channelId === null) return

  try {
    const recorded = await client.recordRoll(interaction.user.id, channelId, description, result)
    if (recorded.kind !== 'ok') return

    // Rebuild from the same data with the status line appended. Splicing it
    // before the buttons keeps the action row last, where it belongs.
    const blocks = [...data.blocks]
    const buttonsAt = blocks.findIndex((block) => block.kind === 'buttons')
    const line = {
      kind: 'text' as const,
      content: `-# LOGGED TO ${recorded.value.game.toUpperCase()}`,
    }
    if (buttonsAt === -1) blocks.push(line)
    else blocks.splice(buttonsAt, 0, line)

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [toContainer({ ...data, blocks })],
    })
  } catch (error) {
    report(error, { source: 'roll-attribution' })
  }
}
