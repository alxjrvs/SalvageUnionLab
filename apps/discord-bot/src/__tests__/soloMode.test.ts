import { describe, expect, test } from 'bun:test'
import { gamesCommand, meCommand, shelfCommand } from '../commands/account.js'
import { crewCommand } from '../commands/crew.js'
import { gameCommand } from '../commands/game.js'
import { itun } from '../commands/itunReply.js'
import { rollCommand } from '../commands/roll.js'
import { fakeExecute } from './fakeInteraction.js'

/**
 * **Solo mode must never regress.**
 *
 * The reference bot — roll and lookup — is the thing people already use,
 * and ADR-030's first principle is that adding accounts must not gate or alter
 * anything that worked without them. The bot mirrors the app's storage modes,
 * and Solo (no ITUN deployment configured) is what almost every install is.
 *
 * `test/env.ts` deliberately leaves `ITUN_*` unset, so this whole file runs in
 * the state a fresh deploy is in.
 */

describe('with no ITUN deployment configured', () => {
  test('there is no client at all', () => {
    expect(itun()).toBeNull()
  })

  test('rolling is untouched — no defer, no edit, just the reply', async () => {
    const { interaction, replies, deferred, edits } = fakeExecute({
      subcommand: 'roll',
      strings: { table: 'Core Mechanic' },
    })
    await rollCommand.execute(interaction)

    // The exact pre-accounts behaviour: one immediate, public reply carrying
    // the result. A deferred roll would be a visibly slower dice bot.
    expect(replies).toHaveLength(1)
    expect(replies[0]?.components).toHaveLength(1)
    expect(deferred.called).toBe(false)
    expect(edits).toHaveLength(0)
  })

  test.each([
    ['me', meCommand],
    ['games', gamesCommand],
    ['shelf', shelfCommand],
    ['crew', crewCommand],
  ])('/su %s explains itself instead of failing', async (name, command) => {
    const { interaction, edits, deferred } = fakeExecute({ subcommand: name })
    await command.execute(interaction)

    // Registered but honest: the command exists, defers ephemerally, and says
    // why it cannot help. A command that vanished based on deployment config
    // would be harder to explain than this.
    expect(deferred.called).toBe(true)
    expect(deferred.ephemeral).toBe(true)
    expect(edits).toHaveLength(1)
    expect(edits[0]?.content).toContain('isn’t connected to In The Union Now')
  })

  test('/su game bind says the same thing', async () => {
    const { interaction, edits } = fakeExecute({
      subcommand: 'bind',
      subcommandGroup: 'game',
      strings: { game: 'g1' },
    })
    await gameCommand.execute(interaction)
    expect(edits[0]?.content).toContain('isn’t connected to In The Union Now')
  })

  test('a Game command outside a channel says so before anything else', async () => {
    // A DM has no channel, so there is no binding to resolve and no useful
    // question to ask the server.
    const { interaction, replies, deferred } = fakeExecute({
      subcommand: 'crew',
      channelId: null,
    })
    await crewCommand.execute(interaction)
    expect(deferred.called).toBe(false)
    expect(replies[0]?.content).toContain('has to be run in a channel')
  })
})
