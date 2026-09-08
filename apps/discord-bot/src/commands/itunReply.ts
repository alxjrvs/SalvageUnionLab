import type { ContainerBuilder } from '@discordjs/builders'
import { MessageFlags } from 'discord-api-types/v10'
import { toContainer } from '../container.js'
import { gameContainerData } from '../gameContainer.js'
import type { EmbedData } from '../gameEmbed.js'
import { denialMessage } from '../gameEmbed.js'
import type { ItunClient } from '../itun/client.js'
import { createItunClient } from '../itun/client.js'
import type { ItunResult } from '../itun/types.js'
import { itunSettings } from '../itunSettings.js'
import type { CommandExecuteInteraction } from './interactions.js'

/**
 * The shared spine of every ITUN Game command (ADR-030 Phase 6).
 *
 * Three things are identical across all of them and are therefore in one place
 * rather than six:
 *
 *  1. **Deferring.** Discord gives a command 3 seconds to acknowledge. A round
 *     trip to Convex usually fits and must not be assumed to, so every Game
 *     subcommand defers before it calls anything.
 *  2. **The three modes.** Solo (no client), Degraded (`unavailable`), and
 *     denied each want different words — see the mode table in the plan. A
 *     single exhaustive branch here means no command can quietly forget one.
 *  3. **Ephemerality.** Denials and errors are *always* ephemeral, whatever the
 *     command's own visibility. That is what makes it safe to state the actual
 *     reason: an ephemeral reply is seen only by the person who asked, so it
 *     never announces to a public channel who holds an account.
 */

/**
 * The bot's ITUN client, or null in Solo mode.
 *
 * Resolved LAZILY, on first use, rather than at module load — and the
 * difference is load-bearing on Workers. Configuration is installed by whichever
 * entrypoint booted (`setItunSettings`), and module bodies evaluate before an
 * entrypoint runs, so resolving here at import time would capture the
 * uninstalled default and pin the bot to Solo mode forever. Under Node that
 * happened to work because `config.ts` read `process.env` at module scope; on
 * Cloudflare the environment does not exist until `fetch` is called with it.
 *
 * `undefined` means "not resolved yet"; `null` means "resolved, and Solo".
 * Conflating the two is what would make Solo mode sticky.
 */
let client: ItunClient | null | undefined

/** The current client, or null in Solo mode. */
export function itun(): ItunClient | null {
  if (client === undefined) {
    client = createItunClient({
      siteUrl: itunSettings().siteUrl,
      botSecret: itunSettings().botSecret,
    })
  }
  return client
}

/**
 * Swap the client, returning a function that puts the old one back.
 *
 * A deliberate, named test seam. Setting an environment variable cannot work:
 * settings are installed once by whichever entrypoint booted, and a test has no
 * entrypoint. `mock.module` is worse still — it is process-global in Bun, so
 * faking configuration for one file would silently hand that fake to every file
 * that ran afterwards.
 *
 * Assigning `client` directly also suppresses the lazy resolution above, which
 * is the behaviour a test wants: it pins the client rather than racing whatever
 * settings happen to be installed.
 *
 * Returning a restore function rather than exposing a setter is the point:
 * a test cannot forget what the previous value was, and `afterEach(restore)`
 * is the whole contract. Solo mode is what everything else must see.
 */
export function setItunClientForTests(next: ItunClient | null): () => void {
  const previous = client
  client = next
  return () => {
    client = previous
  }
}

export const SOLO_NOTICE = [
  '**This server isn’t connected to In The Union Now.**',
  '',
  'Rolling and reference lookups work as normal — `/su roll` and `/su lookup`.',
  'Game commands need the bot to be configured for an ITUN deployment.',
].join('\n')

/**
 * Turn pure `EmbedData` into a discord.js embed, branded like every other.
 *
 * This is where Discord's limits are enforced, rather than in each builder.
 * One choke point means a new builder cannot forget: every `EmbedData` in the
 * bot becomes a real embed here and nowhere else. Keeping it out of the
 * builders also keeps them pure `data → EmbedData`, which is what makes them
 * testable without a Discord client.
 *
 * `enforceEmbedLimits` mutates, which is safe precisely because the argument is
 * always a freshly-built literal from a `build*Embed` call.
 */
export function toGameContainer(data: EmbedData): ContainerBuilder {
  // `toContainer` runs its own guard, which is a different budget from
  // EMBED_LIMIT — do not enforce twice.
  return toContainer(gameContainerData(data))
}

/** The V2 payload for a rendered Game result, at the given visibility. */
function containerPayload(
  data: EmbedData,
  ephemeral: boolean
): { flags: number; components: [ContainerBuilder] } {
  return {
    flags: ephemeral
      ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
      : MessageFlags.IsComponentsV2,
    components: [toGameContainer(data)],
  }
}

/**
 * Run one ITUN call and render it, or explain precisely why it could not run.
 *
 * `render` is only ever reached on success, so a command handler contains no
 * failure branches of its own — which is the point. Every command that forgets
 * to handle "not signed in" is a command that silently does nothing, and this
 * makes forgetting impossible rather than merely discouraged.
 *
 * `visibility: 'public'` posts the rendered result to the channel; failures are
 * **always** ephemeral, whatever the command asked for.
 *
 * That guarantee is why every command defers ephemerally and a public result is
 * then sent as a follow-up, rather than the obvious "defer with the command's
 * own visibility". Discord fixes ephemerality at defer time and will not let it
 * change afterwards, so deferring publicly would put "you are not a member of
 * this game" — a fact about a person — into the channel for everyone. The
 * follow-up costs one extra ephemeral line ("Posted to the channel.") and buys
 * the invariant outright.
 */
export async function respondWithItun<T>(
  interaction: CommandExecuteInteraction,
  options: {
    visibility?: 'public' | 'ephemeral'
    call: (client: ItunClient) => Promise<ItunResult<T>>
    render: (value: T) => EmbedData
  }
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const active = itun()
  if (active === null) {
    await interaction.editReply({ content: SOLO_NOTICE })
    return
  }

  const result = await options.call(active)
  switch (result.kind) {
    case 'ok': {
      const rendered = options.render(result.value)
      const ephemeral = options.visibility !== 'public'
      // Always a follow-up: a new message carries the V2 flag from creation,
      // where an edit of the deferred placeholder would be a toggle Discord
      // refuses. See the note above.
      await interaction.followUp(containerPayload(rendered, ephemeral))
      // The placeholder still has to become something, or it sits on
      // "thinking…" forever. Mirrors the public path's grammar.
      await interaction.editReply({
        content: ephemeral ? 'Rendered below.' : 'Posted to the channel.',
      })
      return
    }
    case 'denied':
      await interaction.editReply({
        content: denialMessage(result.reason, itunSettings().webUrl, result.message),
      })
      return
    case 'unavailable':
      await interaction.editReply({ content: result.message })
      return
  }
}
