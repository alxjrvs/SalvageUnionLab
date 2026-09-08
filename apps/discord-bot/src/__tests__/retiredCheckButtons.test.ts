/**
 * `/su check` is gone, but its buttons are not.
 *
 * Every result the command ever posted is still sitting in a channel with a
 * "Roll again" button carrying `su:check:<notation>`. Those messages are
 * permanent — the bot cannot reach back and edit them — so pressing one is a
 * live production path for as long as the history exists, not a hypothetical.
 *
 * `parseCustomId` no longer accepts `check`, so the router's unknown-action
 * branch is what catches them. That branch already existed for foreign bots'
 * buttons; this pins it for the case that now actually happens, because the
 * alternative — an unhandled action falling through to a crash or to silence —
 * is the failure a player would meet with no way to report it.
 */
import { describe, expect, test } from 'bun:test'
import { MessageFlags } from 'discord-api-types/v10'
import { parseCustomId } from '../customId.js'
import { buttonInteractionHandlerFor } from './helpers.js'

describe('buttons left behind by the retired /su check', () => {
  test('no longer parse', () => {
    expect(parseCustomId('su:check:2d6+3')).toBeNull()
  })

  test('answer with an ephemeral notice rather than failing silently', async () => {
    const { handle, replies } = buttonInteractionHandlerFor('su:check:2d6+3')
    await handle()

    expect(replies).toHaveLength(1)
    const reply = replies[0]
    if (!reply) throw new Error('expected a reply')
    expect(reply.content).toBe('This button is no longer supported.')
    // Ephemeral: a stale button is the presser's problem, not the channel's.
    expect(reply.flags).toBe(MessageFlags.Ephemeral)
  })

  test('the surviving actions still parse, so the guard is not over-broad', () => {
    expect(parseCustomId('su:roll:Core Mechanic')).toEqual({
      action: 'roll',
      payload: 'Core Mechanic',
    })
    expect(parseCustomId('su:lookup:Core Mechanic')).toEqual({
      action: 'lookup',
      payload: 'Core Mechanic',
    })
  })
})
