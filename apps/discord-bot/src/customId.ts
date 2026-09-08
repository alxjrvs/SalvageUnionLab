/**
 * Stateless button plumbing for the bot's interactive "Roll again" / "Roll on
 * this table" buttons.
 *
 * Discord message components carry no server state — everything the button
 * handler needs to re-run a roll must ride in the `customId` string (capped at
 * 100 chars by Discord). We namespace every id `su:<action>:<payload>` so it
 * never collides with another bot's components, and parse it back on click.
 *
 * This is a LEAF module: it imports discord.js only. Command handlers import it
 * to attach rows; the button router (`buttons.ts`) imports it to parse ids.
 * Keeping it dependency-free of the command modules avoids an import cycle.
 */

import { ActionRowBuilder, ButtonBuilder } from '@discordjs/builders'
import { ButtonStyle } from 'discord-api-types/v10'

/** Namespace prefix for every one of this bot's component ids. */
export const CUSTOM_ID_NS = 'su'

/**
 * Leading glyph on every re-roll button label. A typographic symbol (U+21BB
 * clockwise open circle arrow), NOT an emoji — it reads as "roll again / repeat"
 * and has broad font coverage across Discord clients, where a colored emoji
 * would clash with the plain-text embed styling.
 */
const REROLL_SYMBOL = '↻'

/** Discord caps a component customId at 100 characters. */
const CUSTOM_ID_MAX = 100

/**
 * The actions a button can re-invoke. `roll` re-rolls a named Salvage Union
 * table (shared by the roll subcommand's result and the lookup embed's
 * "Roll on this table" button); `lookup` returns the `/su lookup` embed for a
 * named roll-table (the "See table" button on a roll result); `post`
 * re-renders a PRIVATE roll publicly.
 *
 * `post` is the one action whose payload is a RESULT rather than a request.
 * Every other button re-rolls, which is correct for them and wrong here: a
 * "post this to the channel" button that rolled again would share a different
 * outcome from the one the player just looked at, silently. Encoding the roll
 * means the shared result is provably the one they saw, and it still needs no
 * backend — `resultForTable` is pure, so the same table and the same die give
 * the same entry forever.
 */
export type ButtonAction = 'roll' | 'lookup' | 'post'

export type ParsedCustomId = { action: ButtonAction; payload: string }

/** Build a namespaced customId, or null if the payload would exceed the cap. */
export function makeCustomId(action: ButtonAction, payload: string): string | null {
  const id = `${CUSTOM_ID_NS}:${action}:${payload}`
  return id.length <= CUSTOM_ID_MAX ? id : null
}

/**
 * Parse a namespaced customId back into its action + payload. Returns null for
 * anything that isn't one of our ids (other bots' components, malformed input).
 * The payload may itself contain `:`, so we split off only the first two
 * segments and re-join the rest.
 */
export function parseCustomId(customId: string): ParsedCustomId | null {
  const parts = customId.split(':')
  if (parts.length < 3 || parts[0] !== CUSTOM_ID_NS) return null
  const action = parts[1]
  if (action !== 'roll' && action !== 'lookup' && action !== 'post') {
    return null
  }
  return { action, payload: parts.slice(2).join(':') }
}

/** A namespaced button, or null when its payload won't fit in a customId. */
function makeButton(
  action: ButtonAction,
  payload: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary
): ButtonBuilder | null {
  const customId = makeCustomId(action, payload)
  if (!customId) return null
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style)
}

/**
 * A single-button action row that re-invokes `action` with `payload` on click.
 * Returns null when the payload can't fit in a customId — the caller then omits
 * the button rather than emitting an invalid component.
 */
export function rollAgainRow(
  action: ButtonAction,
  payload: string,
  label: string
): ActionRowBuilder<ButtonBuilder> | null {
  const button = makeButton(action, payload, `${REROLL_SYMBOL} ${label}`)
  return button ? new ActionRowBuilder<ButtonBuilder>().addComponents(button) : null
}

/**
 * Encode a rolled result so it can be re-rendered verbatim: `<table>|<n>` for a
 * flat roll, `<table>|<column>|<entry>` for a columns table.
 *
 * `|` rather than `:` because `parseCustomId` re-joins everything after the
 * action, and a table name may itself contain a colon.
 */
export function encodeRollResult(tableName: string, rolls: number[]): string {
  return [tableName, ...rolls.map(String)].join('|')
}

/** The inverse of {@link encodeRollResult}, or null if the payload is malformed. */
export function decodeRollResult(payload: string): { tableName: string; rolls: number[] } | null {
  const parts = payload.split('|')
  const tableName = parts[0]
  if (tableName === undefined || tableName.length === 0 || parts.length < 2) return null
  const rolls = parts.slice(1).map(Number)
  if (rolls.some((n) => !Number.isInteger(n) || n < 1 || n > 20)) return null
  return { tableName, rolls }
}

/**
 * The action row on a `/su roll` result: re-roll the same table, plus a "See
 * table" button that opens the full `/su lookup` embed for it. Each button is
 * included only if its payload fits a customId; returns null if neither does.
 */
export function rollResultRow(tableName: string): ActionRowBuilder<ButtonBuilder> | null {
  const buttons = [
    makeButton('roll', tableName, `${REROLL_SYMBOL} Roll again`),
    makeButton('lookup', tableName, 'See table', ButtonStyle.Primary),
  ].filter((button): button is ButtonBuilder => button !== null)
  return buttons.length ? new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons) : null
}
