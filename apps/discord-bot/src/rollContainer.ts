/**
 * The `/su roll` surface, as a Components V2 container.
 *
 * Replaced `buildRollEmbedData` / `buildCheckEmbedData` in `format.ts`, both of
 * which are now deleted — nothing on any surface sends `embeds:` any more. The
 * `EmbedData` builders in `gameEmbed.ts` and `lookupEmbed.ts` survive as pure
 * data, mapped onto blocks by their container adapters.
 *
 * ## The problem this fixes
 *
 * The embed builder titled every result `outcome.label ?? \`Roll: ${roll}\``,
 * and 76 of the 96 roll tables carry no labels at all. Simulated across every
 * roll 1–20 on every table, **1,482 of 1,882 outcomes — 78.7% — rendered a
 * headline of "Roll: 14"**, with the actual result demoted to body copy. That
 * includes 54 of the 69 `standard` tables: Crawler Damage, Crawler Destruction,
 * Chimerium Exposure. Ordinary play tables, not name generators.
 *
 * ## The headline rule
 *
 * Three branches, no per-table special-casing. The die leads the headline in
 * all three — it is the one number a roller looks for, and there is no longer a
 * provenance line to carry it instead:
 *
 * 1. The entry has a `label` → the label is the headline, the value is the body.
 * 2. No label, value ≤ {@link INLINE_HEADLINE_MAX} → **the value is the
 *    headline**, and there is no body. This is what rescues an unlabelled
 *    table: "Red Mesa Mutants" becomes the headline rather than body copy under
 *    the word "Roll: 14".
 * 3. No label, longer value → quote the entry's own leading sentence as the
 *    headline when it already reads as a name ({@link deriveLabel}); otherwise
 *    the tier word where one applies, else the die number alone. The value is
 *    the body either way.
 *
 * ## Why there are no block glyphs
 *
 * An earlier revision stamped the die into a plate (`▌15▐`) and marked a
 * natural 1 or 20 with a banner, both built from Unicode Block Elements. Seen
 * rendered, the plates read as bare white bars: a container's accent colours
 * its edge, **not** its text, so a TextDisplay is always default-coloured and
 * the glyphs never picked up the tier. The banner had a second problem — it
 * fired on two bands out of five, so the surface looked different depending on
 * what you rolled rather than consistent across every roll.
 *
 * The die number now stands on its own in the headline, which is where it was
 * always meant to be read, separated from the outcome by an em dash — see
 * {@link rollHeadline}. Tier is carried by the accent stripe and the word.
 *
 * ## Why the tier word is Core-Mechanic-only
 *
 * `CORE_ROLL_BANDS` names the bands of *the Core Mechanic*. Those words do not
 * always survive the move to an outcome table: an 11–19 on Crawler Damage means
 * "your Union Crawler is inoperable and grounded", which the band vocabulary
 * would label **SUCCESS**. The colour ramp is defensible there — 20 survives
 * undamaged, 1 is destroyed, so higher genuinely is better — but the word is
 * not, so it is withheld.
 *
 * This is the shape that becomes fully correct once the 54 unlabelled
 * `standard` tables gain authored labels: branch 1 then covers them, and the
 * label says what actually happened instead of a borrowed tier noun.
 */

import type { RollOnTableOutcome, SURefRollTable } from 'salvageunion-reference'
import { getEntitySlug, srdEntityUrl } from 'salvageunion-reference'
import type { CoreRollBand } from 'salvageunion-reference/rules'
import { CORE_ROLL_BANDS, coreRollBand } from 'salvageunion-reference/rules'
import type { ContainerBlock, ContainerData } from './container.js'
import { deriveLabel } from './derivedLabel.js'
import { NEUTRAL_EMBED_COLOR, ROLL_ATTRIBUTION, ROLL_COLORS, truncate } from './format.js'

/** Longest value that reads as a headline rather than as body copy. */
const INLINE_HEADLINE_MAX = 60

/** The name the Core Mechanic table is published under. */
const CORE_MECHANIC = 'Core Mechanic'

/**
 * Table shapes whose 1→20 ramp carries an outcome tier.
 *
 * Derived from the authored `table.type` rather than a hand-kept list of table
 * names, so it cannot rot. The excluded shapes — `flat`, `duos`, `columns`,
 * `dramatic` — are enumerative: rolling a 1 on the Callsign Table means
 * "Sparkles", not a catastrophe, and painting it cascade red (which the embed
 * builder did, unconditionally) was active misinformation on 21 tables.
 */
const TIERED_TABLE_TYPES = new Set([
  'standard',
  'bio-chassis',
  'octet',
  'alternate',
  'salvage-cache',
])

export function isTieredTable(table: SURefRollTable): boolean {
  return TIERED_TABLE_TYPES.has(table.table.type)
}

/** Optional context a caller can stamp onto a roll. */
export type RollContext = {
  /** Display name of whoever rolled, for the context line. */
  roller?: string
  /** Game name, when the roll was recorded. Rendered as a status line. */
  loggedTo?: string
}

/** Uppercase for the stencil voice, and normalise the dataset's mixed casing. */
function stencil(text: string): string {
  return text.toUpperCase()
}

/** `-# TABLE NAME · rolled by X` — the context line above the headline. */
function contextLine(tableName: string, roller?: string): string {
  const name = stencil(tableName)
  return roller ? `-# ${name} · rolled by ${roller}` : `-# ${name}`
}

function loggedLine(game: string): string {
  return `-# LOGGED TO ${stencil(game)}`
}

/**
 * `## 14 — SUCCESS`, or `## 14` when there is nothing to say beside the die.
 *
 * ## Why an em dash
 *
 * `## 14 SUCCESS` ran the two together as one string: a reader looking for the
 * die and a reader looking for the outcome both had to parse the whole line to
 * find their half. Discord paints no colour inside a TextDisplay and a heading
 * is already bold, so weight and hue are both unavailable — punctuation is the
 * only break this surface has, and an em dash is the widest one that renders
 * identically everywhere.
 *
 * One choke point deliberately: every headline on every roll surface comes
 * through here, so the separator cannot drift between them. `errorContainer.ts`
 * imports it for the same reason.
 */
export function rollHeadline(die: string, rest?: string): string {
  return rest !== undefined && rest.length > 0 ? `## ${die} — ${rest}` : `## ${die}`
}

/**
 * Headline + optional body, per the three-branch rule above.
 *
 * `band` is null on an untiered table, which is also what withholds the tier
 * word from branch 3.
 */
function headlineAndBody(
  die: string,
  label: string | undefined,
  value: string,
  band: CoreRollBand | null,
  isCoreMechanic: boolean
): { headline: string; body?: string } {
  if (label !== undefined && label.length > 0) {
    return { headline: rollHeadline(die, stencil(label)), body: value || undefined }
  }
  if (value.length > 0 && value.length <= INLINE_HEADLINE_MAX) {
    return { headline: rollHeadline(die, stencil(value)) }
  }
  // The entry's own words, where they already read as a name. Never a
  // truncation and never a paraphrase — see derivedLabel.ts.
  const quoted = deriveLabel(value)
  if (quoted !== undefined) {
    // The remainder, not the whole value — the quoted sentence has been
    // promoted to the headline and must not be repeated beneath it.
    return { headline: rollHeadline(die, stencil(quoted.label)), body: quoted.rest }
  }
  const tier = band !== null && isCoreMechanic ? stencil(CORE_ROLL_BANDS[band].label) : undefined
  return { headline: rollHeadline(die, tier), body: value || undefined }
}

/**
 * Shape a table roll into container data.
 *
 * Pure: takes the resolved table, the outcome and optional context, and returns
 * blocks. Re-invoking it with `loggedTo` set is how the Game signal is added
 * after the reply — see `rollAttribution.ts`.
 */
export function buildRollContainerData(
  table: SURefRollTable,
  outcome: Extract<RollOnTableOutcome, { success: true }>,
  context: RollContext = {}
): ContainerData {
  const tiered = isTieredTable(table)
  const isCoreMechanic = table.name === CORE_MECHANIC

  // The tier reads off the entry roll on a columns table — the column roll only
  // selects which sub-table you are on and carries no outcome meaning.
  const tierRoll = outcome.kind === 'columns' ? outcome.entryRoll : outcome.roll
  const band = tiered ? coreRollBand(tierRoll) : null

  // Bare numbers. A columns table rolls twice, so both are shown separated by
  // a middot — the provenance line that used to spell them out is gone.
  const die =
    outcome.kind === 'columns' ? `${outcome.columnRoll}·${outcome.entryRoll}` : String(outcome.roll)

  const { headline, body } = headlineAndBody(
    die,
    outcome.label,
    outcome.value,
    band,
    isCoreMechanic
  )

  const blocks: ContainerBlock[] = [
    { kind: 'text', content: contextLine(table.name, context.roller) },
  ]

  blocks.push({ kind: 'text', content: headline })
  if (body !== undefined) blocks.push({ kind: 'text', content: truncate(body, 1800) })

  blocks.push({ kind: 'separator' })
  blocks.push({ kind: 'text', content: `-# ${ROLL_ATTRIBUTION}` })
  if (context.loggedTo !== undefined) {
    blocks.push({ kind: 'text', content: loggedLine(context.loggedTo) })
  }

  return {
    accent: band !== null ? ROLL_COLORS[band] : NEUTRAL_EMBED_COLOR,
    blocks,
  }
}

/** The reference-site page for a roll table, for the `See table` link button. */
export function rollTableUrl(table: SURefRollTable): string {
  return srdEntityUrl('roll-tables', getEntitySlug(table))
}
