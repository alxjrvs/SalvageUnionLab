/**
 * The roll surface's content rules. These are the assertions that pin the
 * behaviour the redesign exists for — the headline never being "Roll: 14", and
 * the tier ramp never being applied to a table that has no tiers.
 */

import { describe, expect, test } from 'bun:test'
import { MessageFlags } from 'discord-api-types/v10'
import type { SURefRollTable } from 'salvageunion-reference'
import { rollOnTable, SalvageUnionReference } from 'salvageunion-reference'
import { buildPostedRollMessage, buildRollMessage } from '../commands/roll.js'
import type { ContainerData } from '../container.js'
import { NEUTRAL_EMBED_COLOR, ROLL_COLORS } from '../format.js'
import { buildRollContainerData, isTieredTable, rollTableUrl } from '../rollContainer.js'

// No preload here. `apps/discord-bot/bunfig.toml` preloads
// `../../test/reference-preload.ts`, which loads every schema once for the
// whole workspace — a per-file `preload('all')` is at best a no-op and at
// worst hides an ordering bug, which is why `test-hygiene.test.ts` bans it.

function table(name: string): SURefRollTable {
  const found = SalvageUnionReference.RollTables.getByName(name)
  if (!found) throw new Error(`no such table: ${name}`)
  return found
}

/** Build the container data for a fixed roll. */
function rollOf(name: string, roll: number, context = {}): ContainerData {
  const outcome = rollOnTable(table(name).table, () => roll)
  if (!outcome.success) throw new Error(`no entry for ${roll} on ${name}`)
  return buildRollContainerData(table(name), outcome, context)
}

function text(data: ContainerData): string {
  return data.blocks.map((b) => (b.kind === 'text' ? b.content : '')).join('\n')
}

function headline(data: ContainerData): string {
  return text(data)
    .split('\n')
    .find((line) => line.startsWith('## ')) as string
}

describe('the headline is never a bare die number', () => {
  // 76 of 96 tables carry no labels; the old builder titled all of them
  // `Roll: N`. Measured across every roll on every table, that was 78.7% of
  // all outcomes.
  test('no table produces a "Roll: N" headline on any roll', () => {
    for (const t of SalvageUnionReference.RollTables.all()) {
      for (let roll = 1; roll <= 20; roll++) {
        const outcome = rollOnTable(t.table, () => roll)
        if (!outcome.success) continue
        const line = headline(buildRollContainerData(t, outcome))
        expect(line).not.toContain('Roll:')
      }
    }
  })

  test('an unlabelled short value becomes the headline itself', () => {
    // Callsign entries are bare words with no label — previously the value was
    // the title only by accident of the columns branch, and flat tables put it
    // in the body under "Roll: 14".
    expect(headline(rollOf('Callsign Table', 1))).toContain('SPARKLES')
  })

  test('a labelled entry uses its label, and keeps the value as the body', () => {
    const data = rollOf('Critical Injury', 1)
    expect(headline(data)).toContain('FATAL INJURY')
    expect(text(data)).toContain('fatal injury')
  })

  test('a long unlabelled value is quoted into the headline, not left in the body', () => {
    // Previously this rendered `## 14` alone with the whole value beneath.
    // The entry's own leading sentence now carries the headline, and the body
    // picks up from the next one rather than repeating it.
    const data = rollOf('Crawler Damage', 14)
    expect(headline(data)).toContain('14')
    expect(headline(data)).toContain('INOPERABLE AND GROUNDED')
    const body = text(data)
      .split('\n')
      .filter((line) => !line.startsWith('#') && !line.startsWith('-#'))
      .join('\n')
    expect(body).toContain('Its Bays are Intact')
    expect(body).not.toContain('inoperable and grounded.')
  })
})

describe('tier gating', () => {
  test('monotone outcome ramps are tiered; enumerative tables are not', () => {
    expect(isTieredTable(table('Core Mechanic'))).toBe(true)
    expect(isTieredTable(table('Crawler Damage'))).toBe(true)
    expect(isTieredTable(table('Callsign Table'))).toBe(false)
  })

  test('a 1 on an untiered table is NOT cascade red', () => {
    // The old builder applied getColor() unconditionally, so rolling a 1 on the
    // Callsign Table painted the embed cascade red and implied "Sparkles" was a
    // catastrophe. It affected 21 tables.
    expect(rollOf('Callsign Table', 1).accent).toBe(NEUTRAL_EMBED_COLOR)
  })

  test('a tiered table still takes the ramp', () => {
    expect(rollOf('Core Mechanic', 20).accent).toBe(ROLL_COLORS.nailed)
    expect(rollOf('Core Mechanic', 1).accent).toBe(ROLL_COLORS.cascade)
    expect(rollOf('Core Mechanic', 14).accent).toBe(ROLL_COLORS.success)
  })
})

describe('the tier word is withheld outside the Core Mechanic', () => {
  test('the Core Mechanic names its band', () => {
    expect(headline(rollOf('Core Mechanic', 20))).toContain('NAILED IT')
    expect(headline(rollOf('Core Mechanic', 1))).toContain('CASCADE FAILURE')
  })

  test('an outcome table does not — "SUCCESS" over a grounded Crawler reads wrong', () => {
    const data = rollOf('Crawler Damage', 14)
    expect(data.accent).toBe(ROLL_COLORS.success)
    expect(headline(data)).not.toContain('SUCCESS')
  })
})

describe('every roll renders the same furniture', () => {
  // The surface used to change shape with the result: a 1 and a 20 grew a
  // Block-Elements banner the other 18 rolls did not have, so a table looked
  // like a different bot depending on what came up. It is now one shape.
  test.each([1, 2, 10, 19, 20])('a %i draws no banner', (roll) => {
    const body = text(rollOf('Core Mechanic', roll))
    expect(body).not.toContain('▓')
    expect(body).not.toContain('█')
    expect(body).not.toContain('░')
  })

  test('the die stands bare in the headline, with no plate around it', () => {
    // Seen rendered, `▌14▐` read as a white bar: a container's accent colours
    // its edge, not its text, so the glyphs never picked up the tier.
    const line = headline(rollOf('Core Mechanic', 14))
    expect(line).toContain('14')
    expect(line).not.toContain('▌')
    expect(line).not.toContain('▐')
  })

  test('a columns roll shows both dice', () => {
    expect(headline(rollOf('Callsign Table', 1))).toContain('1·1')
  })

  test('an em dash separates the die from the outcome', () => {
    // `## 14 SUCCESS` ran the two together as one string. Discord paints no
    // colour inside a TextDisplay and a heading is already bold, so punctuation
    // is the only break available — and nothing else in the suite pins it.
    expect(headline(rollOf('Core Mechanic', 14))).toBe('## 14 — SUCCESS')
    expect(headline(rollOf('Core Mechanic', 20))).toBe('## 20 — NAILED IT')
  })

  test('no dangling dash when the die is all there is to say', () => {
    // An untiered table with a long unquotable entry has no word to put beside
    // the number, and `## 7 — ` would be worse than the bare number.
    for (const table of SalvageUnionReference.RollTables.all()) {
      for (let roll = 1; roll <= 20; roll++) {
        const outcome = rollOnTable(table.table, () => roll)
        if (!outcome.success) continue
        expect(headline(buildRollContainerData(table, outcome))).not.toMatch(/—\s*$/)
      }
    }
  })

  test('one footer line, and it is the attribution', () => {
    // The provenance line — `d20 14 · band 11-19 · Core Book p.219` — is gone;
    // two lines of small print under every roll was the busiest part of the
    // surface, and the die it spelled out is already the headline.
    const small = text(rollOf('Crawler Damage', 14))
      .split('\n')
      .filter((line) => line.startsWith('-# '))
    expect(small).toHaveLength(2) // context line + attribution
    expect(small.at(-1)).toBe('-# Salvage Union Reference · Powered by Randsum.dev')
    expect(text(rollOf('Crawler Damage', 14))).not.toContain('p.219')
  })
})

describe('context', () => {
  test('names the roller when given one', () => {
    expect(text(rollOf('Core Mechanic', 14, { roller: 'Vex Marrow' }))).toContain(
      'rolled by Vex Marrow'
    )
  })

  test('the Game signal is its own line, not appended to attribution boilerplate', () => {
    const body = text(rollOf('Core Mechanic', 14, { loggedTo: 'Tenacity' }))
    expect(body).toContain('-# LOGGED TO TENACITY')
  })

  test('no Game signal when the roll was not recorded', () => {
    expect(text(rollOf('Core Mechanic', 14))).not.toContain('LOGGED TO')
  })
})

test('the See table link resolves to the reference site, with no trailing slash', () => {
  const url = rollTableUrl(table('Core Mechanic'))
  expect(url).toBe('https://salvageunion.io/schema/roll-tables/item/core-mechanic')
})

describe('a dramatic table miss is a result, not an error', () => {
  // Blinding Blue Laser Rifle and Bio-Talon carry only a `20` key, so
  // resultForTable reports failure on 19 of every 20 rolls. The old builder
  // rendered its internal diagnostic — "No result found for roll 7" — to the
  // user as an error. That is not an error; it is what the book means.
  test.each([1, 7, 19])('a %i renders NO EFFECT publicly', (roll) => {
    const message = buildRollMessage('Bio-Talon', 'Vex Marrow', () => roll)
    if ('error' in message) throw new Error('a miss must not be an error')
    const body = message.data.blocks.map((b) => (b.kind === 'text' ? b.content : '')).join('\n')
    expect(body).toContain('NO EFFECT')
    expect(body).toContain('only triggers on a 20')
    expect(body).not.toContain('No result found')
    // A result, so it is public — no ephemeral flag.
    expect(message.ephemeral).toBeUndefined()
  })

  test('a 20 still rolls the real entry', () => {
    const message = buildRollMessage('Bio-Talon', 'Vex Marrow', () => 20)
    if ('error' in message) throw new Error('expected a roll')
    const body = message.data.blocks.map((b) => (b.kind === 'text' ? b.content : '')).join('\n')
    expect(body).not.toContain('NO EFFECT')
    expect(body).toContain('## 20')
  })
})

describe('private rolls and Post to channel', () => {
  test('a private roll is ephemeral and offers a Post button', () => {
    const message = buildRollMessage('Core Mechanic', 'Vex Marrow', () => 14, true)
    if ('error' in message) throw new Error('expected a roll')
    expect(message.ephemeral).toBe(true)
    expect(Number(message.flags) & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral)
    const row = message.data.blocks.find((b) => b.kind === 'buttons')
    const labels =
      row?.kind === 'buttons' ? row.buttons.map((b) => ('label' in b ? b.label : '')) : []
    expect(labels).toContain('Post to channel')
  })

  test('a public roll offers no Post button — it is already in the channel', () => {
    const message = buildRollMessage('Core Mechanic', 'Vex Marrow', () => 14, false)
    if ('error' in message) throw new Error('expected a roll')
    expect(message.ephemeral).toBeUndefined()
    const row = message.data.blocks.find((b) => b.kind === 'buttons')
    const labels =
      row?.kind === 'buttons' ? row.buttons.map((b) => ('label' in b ? b.label : '')) : []
    expect(labels).not.toContain('Post to channel')
  })

  test('posting replays the SAME result, it does not roll again', () => {
    // The property the whole encoding exists for. A button that re-rolled
    // would silently share a different outcome from the one on screen.
    const priv = buildRollMessage('Core Mechanic', 'Vex Marrow', () => 20, true)
    if ('error' in priv) throw new Error('expected a roll')
    const row = priv.data.blocks.find((b) => b.kind === 'buttons')
    const post =
      row?.kind === 'buttons'
        ? row.buttons.find((b) => 'label' in b && b.label === 'Post to channel')
        : undefined
    if (post === undefined || post.kind !== 'action') throw new Error('expected a post button')

    const payload = post.customId.replace(/^su:post:/, '')
    const posted = buildPostedRollMessage(payload, 'Vex Marrow')
    if ('error' in posted) throw new Error('expected a posted roll')

    expect(text(posted.data)).toContain('## 20')
    expect(text(posted.data)).toContain('NAILED IT')
    expect(posted.data.accent).toBe(ROLL_COLORS.nailed)
    // Public, and it carries no Post button of its own.
    expect(Number(posted.flags) & MessageFlags.Ephemeral).toBe(0)
    const postedRow = posted.data.blocks.find((b) => b.kind === 'buttons')
    const postedLabels =
      postedRow?.kind === 'buttons'
        ? postedRow.buttons.map((b) => ('label' in b ? b.label : ''))
        : []
    expect(postedLabels).not.toContain('Post to channel')
  })

  test('a columns roll round-trips both dice', () => {
    const priv = buildRollMessage('Callsign Table', undefined, () => 7, true)
    if ('error' in priv) throw new Error('expected a roll')
    const row = priv.data.blocks.find((b) => b.kind === 'buttons')
    const post =
      row?.kind === 'buttons'
        ? row.buttons.find((b) => 'label' in b && b.label === 'Post to channel')
        : undefined
    if (post === undefined || post.kind !== 'action') throw new Error('expected a post button')
    const posted = buildPostedRollMessage(post.customId.replace(/^su:post:/, ''), undefined)
    if ('error' in posted) throw new Error('expected a posted roll')
    expect(text(posted.data)).toBe(text(priv.data).replace(/\n?-# .*Post.*/g, ''))
  })

  test('a malformed post payload errors rather than throwing', () => {
    expect(buildPostedRollMessage('not-a-payload')).toHaveProperty('error')
    expect(buildPostedRollMessage('Core Mechanic|99')).toHaveProperty('error')
  })
})
