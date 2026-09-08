/**
 * /su namespace command — builder shape + subcommand dispatch.
 *
 * The handlers' behavior is covered by format.test.ts (pure functions);
 * these tests pin the registration contract: one top-level command named
 * `su` carrying the reference subcommands, the In The Union Now subcommands,
 * and the `game` subcommand GROUP, with execute/autocomplete routed by
 * getSubcommand() and getSubcommandGroup().
 */
import { describe, expect, test } from 'bun:test'
import { commands } from '../commands/index.js'
import { suCommand } from '../commands/su.js'
import { fakeAutocomplete, fakeExecute } from './fakeInteraction.js'

describe('/su command', () => {
  test('is the only registered top-level command', () => {
    expect([...commands.keys()]).toEqual(['su'])
  })

  test('registers every subcommand, including the game group', () => {
    const json = suCommand.data.toJSON()
    expect(json.name).toBe('su')
    const subs = (json.options ?? []).map((o) => o.name).sort()
    // The ITUN subcommands are registered UNCONDITIONALLY — a command that
    // appears or vanishes depending on deployment configuration is harder to
    // explain than one that answers "this server isn't connected".
    expect(subs).toEqual(['crew', 'game', 'games', 'lookup', 'me', 'roll', 'sheet', 'shelf'])

    // Discord caps a command at 25 options, and subcommands + groups both
    // count against it. Worth pinning: overflowing fails at deploy time, in a
    // Discord API error, not here.
    expect(subs.length).toBeLessThanOrEqual(25)

    const roll = (json.options ?? []).find((o) => o.name === 'roll')
    const lookup = (json.options ?? []).find((o) => o.name === 'lookup')
    expect(
      (roll as { options?: { name: string; autocomplete?: boolean }[] }).options?.[0]
    ).toMatchObject({ name: 'table', autocomplete: true, required: false })
    expect(
      (lookup as { options?: { name: string; autocomplete?: boolean }[] }).options?.[0]
    ).toMatchObject({ name: 'entity', autocomplete: true, required: true })

    // `game` is a GROUP (type 2), not a subcommand (type 1) — the distinction
    // is what makes `/su game bind` dispatch correctly.
    const game = (json.options ?? []).find((o) => o.name === 'game')
    expect((game as { type: number }).type).toBe(2)
    expect((game as { options?: { name: string }[] }).options?.map((o) => o.name).sort()).toEqual([
      'bind',
      'info',
      'unbind',
    ])
  })

  test('execute throws loudly on an unknown subcommand', async () => {
    const { interaction } = fakeExecute({ subcommand: 'nonsense' })
    await expect(suCommand.execute(interaction)).rejects.toThrow('Unknown /su subcommand')
  })

  test('autocomplete responds empty on an unknown subcommand', async () => {
    const { interaction, responses } = fakeAutocomplete({ subcommand: 'nonsense' })
    await suCommand.autocomplete(interaction)
    expect(responses[0]).toEqual([])
  })
})
