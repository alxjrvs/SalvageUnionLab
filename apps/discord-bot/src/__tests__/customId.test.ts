/**
 * customId scheme tests — the stateless button plumbing behind "Roll again" /
 * "Roll on this table".
 *
 * The router (interactionCreate.test.ts) covers the happy dispatch; these pin
 * the encoding contract directly: the namespaced roundtrip, rejection of
 * foreign / malformed ids, and the 100-char cap that makes `rollAgainRow`
 * return null (an over-long payload must still render — just without a
 * re-roll button).
 */
import { describe, expect, test } from 'bun:test'
import { makeCustomId, parseCustomId, rollAgainRow, rollResultRow } from '../customId.js'

describe('makeCustomId / parseCustomId', () => {
  test('roundtrips a namespaced action + payload', () => {
    const id = makeCustomId('roll', 'Core Mechanic')
    expect(id).toBe('su:roll:Core Mechanic')
    if (!id) throw new Error('expected a customId')
    expect(parseCustomId(id)).toEqual({ action: 'roll', payload: 'Core Mechanic' })
  })

  test('preserves a payload that itself contains colons', () => {
    const id = makeCustomId('roll', 'Odd: Table')
    if (!id) throw new Error('expected a customId')
    expect(parseCustomId(id)).toEqual({ action: 'roll', payload: 'Odd: Table' })
  })

  test('roundtrips the lookup action (the "See table" button)', () => {
    const id = makeCustomId('lookup', 'Core Mechanic')
    expect(id).toBe('su:lookup:Core Mechanic')
    if (!id) throw new Error('expected a customId')
    expect(parseCustomId(id)).toEqual({ action: 'lookup', payload: 'Core Mechanic' })
  })

  test('rejects foreign and malformed ids', () => {
    expect(parseCustomId('someotherbot:thing')).toBeNull()
    expect(parseCustomId('su')).toBeNull()
    expect(parseCustomId('su:unknownaction:x')).toBeNull()
  })

  test('returns null when the id would exceed the 100-char cap', () => {
    const huge = 'x'.repeat(120)
    expect(makeCustomId('roll', huge)).toBeNull()
    expect(rollAgainRow('roll', huge, 'Roll again')).toBeNull()
  })
})

describe('rollAgainRow', () => {
  test('builds a single-button action row for a normal payload', () => {
    const row = rollAgainRow('roll', 'Core Mechanic', 'Roll again')
    expect(row).not.toBeNull()
    if (!row) throw new Error('expected an action row')
    const json = row.toJSON()
    expect(json.components).toHaveLength(1)
    const [button] = json.components
    // Narrow the API component union at runtime instead of asserting a shape.
    if (!button || !('custom_id' in button) || !('label' in button)) {
      throw new Error('expected a labeled custom-id button')
    }
    expect(button.custom_id).toBe('su:roll:Core Mechanic')
    // Label is prefixed with the ↻ repeat symbol (a typographic glyph, not an emoji).
    expect(button.label).toBe('↻ Roll again')
  })
})

describe('rollResultRow', () => {
  test('pairs a re-roll button with a "See table" lookup button', () => {
    const row = rollResultRow('Core Mechanic')
    expect(row).not.toBeNull()
    if (!row) throw new Error('expected an action row')
    const json = row.toJSON()
    expect(json.components).toHaveLength(2)
    const labeled = json.components.map((c) => {
      // Narrow the API component union at runtime instead of asserting a shape.
      if (!('custom_id' in c) || !('label' in c)) {
        throw new Error('expected a labeled custom-id button')
      }
      return c
    })
    expect(labeled[0]?.custom_id).toBe('su:roll:Core Mechanic')
    expect(labeled[0]?.label).toBe('↻ Roll again')
    expect(labeled[1]?.custom_id).toBe('su:lookup:Core Mechanic')
    expect(labeled[1]?.label).toBe('See table')
  })

  test('drops both buttons when the table name overflows the customId cap', () => {
    expect(rollResultRow('x'.repeat(120))).toBeNull()
  })
})
