# The Discord Bot as a Game Client

**Status: Phases 0–4 BUILT.** Phases 5–6 remain as drawn. Delivery plan for
[issue #623](https://github.com/alxjrvs/SU-SRD/issues/623) — Phase 6 of
[ADR-030](../adrs/ADR-030-accounts-games-server-of-record.md). Read
[`accounts-and-games.md`](accounts-and-games.md) first for the account model this
sits on, and [ADR-021](../adrs/ADR-021-itun-surface-taxonomy.md) for the
surface/mode taxonomy that decides what the bot is allowed to do.

---

## 1. What actually exists today

> **Wired in production on 2026-08-19.** Until then the Connected surface had
> never been switched on: `ITUN_BOT_SECRET` was absent from the Convex
> production deployment *and* from the bot, so every Game command reported "not
> connected" and the bot ran permanently in Solo mode. It was written, tested,
> and unreachable.
>
> Both halves are now set, and the credential exists in exactly two places:
>
> | Side                     | Variable                                   |
> | ------------------------ | ------------------------------------------ |
> | Convex prod deployment   | `ITUN_BOT_SECRET`                          |
> | `su-discord-bot` Worker  | `ITUN_BOT_SECRET` + `ITUN_CONVEX_SITE_URL` |
>
> `ITUN_CONVEX_SITE_URL` is `https://exuberant-porpoise-183.convex.site` — the
> **`.convex.site`** HTTP-actions origin, not the `.convex.cloud` client URL.
> Getting that wrong is the quiet failure: the bot reports itself unreachable
> rather than misconfigured.
>
> **Generate and write both sides in one pass.** A mismatch fails as
> `unauthorized` with nothing to say which side is wrong, and neither side can
> show you its value afterwards to compare. One `openssl rand`, piped to
> `convex env set` and `wrangler secret put` in the same script, removes the
> failure mode entirely — and never prints the secret.
>
> **Verify without knowing the secret**, using the route's own two-failure
> design: `POST /bot/<op>` with no credential answers **404** when
> `ITUN_BOT_SECRET` is unset (the surface is meant to be indistinguishable from
> absent) and **401** once it is set. So `404 → 401` *is* the proof the Convex
> half took. On the bot half, `GET /health` flips `configured.itun` to `true`
> and `mode` to `connected`.
>
> Note what that does **not** prove: `/health` checks the variables are present,
> not that the two values match. Only a real Game command exercises the
> credential end to end.

Phase 6 is ticked ✅ in `accounts-and-games.md`. That tick is **half right, and
the wrong half is load-bearing** — so start here rather than from the checklist.

| Piece                                        | State                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `convex/bot.ts` (204 lines, fully tested)    | **Written.** Bindings, actor resolution, roll recording, roll history.                    |
| `channelBindings` table + `users.by_discord` | **Written.** Schema and indexes are in place.                                             |
| `convex/__tests__/bot.test.ts`               | **Written.** Proves the bot cannot act as a non-member.                                   |
| Any caller of `api.bot.*`                    | **None.** `grep` finds zero references in `apps/itun/src` **and** `apps/discord-bot/src`. |
| A way for the bot to authenticate to Convex  | **Does not exist.** See below — this is the blocker.                                      |

So the server layer is real and the wiring is absent on _both_ ends. Two
consequences follow, and the second is a live defect:

**a. `gameForChannel` is uncallable by the bot.** It opens with
`requireUser(ctx)`, which resolves the caller's identity from a Convex auth
token. The bot has no token, so the one query it most needs always throws.

**b. `recordRoll` is callable by _anyone_.** It performs no auth check at all —
it trusts the `discordId` passed as an argument. The Convex deployment URL is
public (it ships in the SPA bundle), and channel ids and Discord user ids are
both readable by anyone in the server. Today a stranger can forge Change Log
entries attributed to any linked player in any bound Game. Nothing is bound yet,
so nothing is currently exploitable — but this must be closed in the same change
that binds the first channel, not after.

`bot.ts` was written as though the credential question were already settled. It
isn't. **Section 3 is the decision this whole plan turns on.**

---

## 2. What the bot is for

ADR-021 asks every surface which mode it enforces. The bot is not a Wizard and
not a Live Sheet. It is closest to the Dashboard — in-session, transactional —
but narrower still, because chat is a bad editor and a superb noticeboard.

> **The bot reads widely and writes narrowly.**
> It may show anything a member is entitled to see. It may write only through
> mutations that already exist, and only facts already modelled as a transaction
> or a proposal on the Change Log. It never opens a second write path.

Three things chat is genuinely better at than the app, and they are the whole
product case:

1. **Glancing** — "what's everyone's HP?" without anyone alt-tabbing out of the
   voice channel.
2. **Attributing** — a roll made in the channel is a roll the table saw. It
   should be the same kind of fact as one made on the Dashboard.
3. **Shouting** — the Mediator says something happened, and it lands where
   people are already looking.

Everything below is one of those three, or it is a non-goal.

### Non-goals, explicitly

- **No character creation or editing in Discord.** That is the Wizard's job.
- **No `/su damage @player 3`.** A Mediator writing another player's sheet is
  forbidden by ADR-030 §4 regardless of surface. It becomes a _proposal_ or it
  does not exist.
- **No new mutations for the bot's convenience.** If a thing cannot be said with
  an existing Convex function, that is a signal to stop, not to add one.
- **No service-role key that can act as anybody.** This is the thing #165 was
  rejected for. Section 3 is honest about how close option A gets to it.
- **No `apps/srd` involvement.** It stays static, public, and login-free.

---

## 3. Decision: how the bot authenticates

The bot is a server process that learns a Discord user id from an interaction
and wants Convex to act on that person's behalf. Somebody has to be trusted to
say "this request is really from user 12345". The only question is **who**, and
what a leak of that trust costs.

### Option A — Convex HTTP actions + a shared bot secret ✅ recommended for now

Add a `/bot/*` route namespace to `convex/http.ts`. The bot sends
`Authorization: Bearer $ITUN_BOT_SECRET` plus the Discord user id it received.
Convex verifies the secret, resolves `discordId → user → membership`, and then
runs **the same** `model/permissions.ts` checks every other caller runs.

- **For:** small; keeps the existing Render gateway bot; one credential to
  rotate; the permission model is genuinely unchanged, so an Organizer-only act
  stays Organizer-only.
- **Against, stated plainly:** the secret asserts identity. Whoever holds it can
  claim to be any linked player — including the Organizer — and read every sheet
  in every bound Game. It is _not_ a service-role key (it cannot invent a
  membership, cannot touch an unlinked account, cannot reach a shelf, cannot see
  `encounterNpcs`), but it is a bearer credential and calling it anything softer
  would be dishonest.
- **Mitigations:** store it in 1Password → Render env, never in git; give the
  route namespace no function that a member could not already call; rotate on
  any suspicion. Note that this is still a **strict improvement** on today,
  where `recordRoll` needs no credential at all.

### Option B — Discord HTTP interactions hosted on Convex ⭐ the endgame

Point Discord's interactions endpoint at a Convex HTTP action. Discord signs
every payload with Ed25519; Convex verifies it against the application public
key. The user id is then **cryptographically attested by Discord** rather than
asserted by us. No bearer secret exists to leak.

This is the model ADR-030 was actually reaching for ("no privileged token to
leak"), and one usually-fatal objection does not apply here: **this bot does not
need a gateway connection.** It declares only `GatewayIntentBits.Guilds`, reads
no message content, and every single thing it does — commands, autocomplete,
buttons — arrives as an interaction. A gateway socket is buying it nothing.

- **For:** the correct trust model; likely retires the Render worker entirely.
- **Against:** a real rewrite of the transport (discord.js gateway client → raw
  signed-request handling) that puts the working `/su roll|check|lookup` surface
  at risk for zero user-visible gain; autocomplete and deferred responses need
  reworking against the 3-second ack window; alert push becomes an outbound REST
  call from a Convex action rather than a `client.channels.send`.

**Recommendation: ship A, write B down as the intended destination.** The
migration is transport-only if the Convex functions are designed to not care who
called them — which is the shape they already have. Do not do B first: it
front-loads the riskiest work before the feature has proven it is wanted.

### Option C — per-user OAuth tokens, rejected

The bot could hold a real Convex token per player via a device-code flow.
Impersonation becomes impossible. But the bot then stores N refresh tokens —
arguably a worse thing to leak than one secret — plus a token store and refresh
handling, and ADR-030 explicitly chose Discord-as-sole-provider to _avoid_ a
separate credential story. Rejected.

---

## 4. Decision: there is no linking step to build

`bot.linkDiscordId` asks the user to paste their Discord snowflake into the web
app. **Delete it.** The link already happened.

Discord is the only auth provider, and `@convex-dev/auth` records every sign-in
in `authAccounts` as `{ provider: 'discord', providerAccountId: <snowflake> }`,
indexed as `providerAndAccountId`. Every signed-in ITUN account therefore
_already carries_ the exact identifier the bot has in hand. Asking for it again
is asking someone to re-key a value we hold.

Instead:

- Stamp `users.discordId` from the OAuth profile in an `afterUserCreatedOrUpdated`
  callback in `convex/auth.ts`, so it is correct from the first sign-in.
- Add a one-shot internal backfill reading `authAccounts` for existing users.
- Keep `users.discordId` and its `by_discord` index exactly as they are — the
  bot's hot lookup stays one indexed read, rather than a join through
  `authAccounts` on every interaction.
- Retire the `linkDiscordId` mutation.

This is the single highest-leverage finding in this document. It turns "link
your account" — a flow with a paste step, a validation error state, a
mismatched-id support burden, and a mid-funnel drop-off — into **nothing at
all**. `/su me` stops being a linking command and becomes a confirmation:
_you're already here_.

---

## 5. Decision: the bot gets Solo and Connected modes too

ADR-030 gives the app three modes. The bot gets the same shape, and this is what
keeps it from becoming a second product:

| Bot mode      | Condition                         | Behaviour                                                                         |
| ------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| **Solo**      | `CONVEX_URL` unset                | Exactly today's bot. Roll, check, lookup. Game subcommands reply "not connected". |
| **Connected** | `CONVEX_URL` + secret set         | Full surface.                                                                     |
| **Degraded**  | Convex configured but unreachable | Reference commands keep working; Game commands say so, ephemerally.               |

The rule this buys: **`/su roll` and `/su lookup` must behave
byte-identically whether or not Convex is configured.** The reference bot is the
thing people already use; accounts must not be able to break it. Subcommands are
always registered — a command that vanishes based on server config is harder to
explain than one that answers honestly.

### Silence vs. explanation

`resolveActor` deliberately returns `null` for all three failure modes (no
binding / no account / not a member) so a public channel never reveals who has
an account. That is right for _passive_ paths and wrong for _explicit_ ones:

- **Passive** (a roll being recorded): stay silent. The roll still works; it
  simply is not recorded. Nobody is owed an explanation for a thing they did not
  ask for.
- **Explicit** (`/su crew` in an unbound channel): reply **ephemerally** with the
  actual reason. An ephemeral reply is visible only to the person who asked, so
  it leaks nothing — and a command that does nothing with no explanation is the
  worst outcome of the three.

---

## 6. The command surface

Everything hangs off the existing `/su` namespace, which already exists for
exactly this reason ("every future subcommand lands collision-proof with zero
naming deliberation" — `su.ts`). Discord permits mixing subcommands and
subcommand groups on one command, up to 25 options.

```
/su roll            (exists — gains attribution)
/su lookup          (exists — unchanged)
/su me                             → who am I, what am I in
/su games                          → my Games
/su shelf                          → my entities not in play
/su crew                           → this channel's Game, at a glance
/su sheet   <entity>               → drill into a crewmate, read-only
/su game    bind <game> | unbind | info
```

| Command         | Convex                                                                       | Visibility                    | Why it earns a slot                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/su me`        | `account.me`, `games.listMine`                                               | ephemeral                     | The "am I connected?" answer, and the only onboarding surface the bot needs. Doubles as the sign-in prompt for anyone who isn't.          |
| `/su games`     | `games.listMine`                                                             | ephemeral                     | Directly asked for. Cheap. Also the picker source for `bind`.                                                                             |
| `/su shelf`     | `entities.listShelf`                                                         | ephemeral                     | "List entities" for the personal case. Private by construction — a shelf has no Game and no crew.                                         |
| **`/su crew`**  | `crew.vitals`, `downtime.state`, `mediator.presence`                         | **public**                    | **The reason to build any of this.** Four numbers per crewmate, in the channel, mid-session. Nothing else the bot does beats alt-tabbing. |
| `/su sheet`     | `crew.readEntity`                                                            | ephemeral + _Post to channel_ | "Lean over and look at their sheet." Ephemeral because reading is private; shareable because sometimes the table should see it.           |
| `/su game bind` | `bot.bindChannel`                                                            | ephemeral ack + public notice | Organizer-only. The public notice matters: binding changes what the channel means for everyone in it.                                     |
| `/su game info` | `bot.gameForChannel`, `games.members`, `downtime.state`, `mediator.presence` | public                        | Roster, roles, who's at the table, Downtime phase. The channel's "what is this table" card.                                               |

### Roll attribution is an upgrade, not a command

`/su roll` gains **no options and no flag** for attribution. When the channel is
bound and the invoker resolves to a member, the roll is recorded via
`bot.recordRoll` and the embed footer gains ` · recorded to Tenacity`. Otherwise
the output is what it is today, to the byte.

This is the whole of #623's exit criterion — _"a roll in Discord appears on the
table's Dashboard, attributed to the right player"_ — and it costs one footer
string and one fire-and-forget mutation. A separate `/su gameroll` would be a
worse product and a second thing to teach.

### Alerts → the channel

Issue #623's fourth checkbox. A Mediator broadcast (`proposals.broadcast`) should
land in the bound channel as well as on the Dashboard. This needs the bot to
**subscribe** rather than poll: `ConvexClient` from `convex/browser` runs in Node
and holds websocket subscriptions.

Flagged as the highest-complexity item, and deliberately last, because it is the
only piece that turns the bot from request/response into a stateful listener —
one subscription per bound channel, reconnection handling, and dedup so a
restart does not replay yesterday's alerts.

### Stretch: proposals with Apply/Decline buttons

A Mediator proposes "-3 HP"; the player gets a Discord card with `[Apply]`
`[Decline]`. Very Discord-native, and legitimate under ADR-030 — the player is
still the one applying, and there is still no force-apply.

Held back deliberately anyway. It is the bot's first real write on a player's
own sheet, and it should not ship until the read surfaces have proven the
channel is somewhere people actually look. Until then, an alert with a deep link
to the Dashboard is the honest version.

---

## 7. Rendering

### The rules

1. **Follow `lookupEmbed.ts`.** It is a pure `data → EmbedData` builder that
   imports no discord.js; the command module maps it onto an `EmbedBuilder`. New
   builders go in `gameEmbed.ts` with the same split, so they are testable
   without a Discord client and without a network.
2. **Every embed has a door back to the app.** Discord is the glance; ITUN is the
   surface. Anything representing a Game or an entity carries a
   `https://intheunionnow.com/...` link. The lookup embed already does this for
   `salvageunion.io`.
3. **Public is for the table, ephemeral is for the person.** Rolls, the crew
   board, alerts and bind notices are public. Identity, shelves, drill-ins and
   every error are ephemeral. Any ephemeral card worth sharing gets a
   _Post to channel_ button (a new `share` action on the existing
   `su:<action>:<payload>` customId scheme — Convex ids are ~32 chars, well
   inside the 100-char cap).
4. **Colour carries one meaning only.** Keep the existing rust (`0xb7410e`) for
   everything informational. The single sanctioned deviation is a
   destroyed/critical state, which reuses the colour
   [ADR-009](../adrs/ADR-009-condition-model-destroyed-color.md) already defines
   rather than inventing a bot palette.

   > **Amended when `/su sheet` became a sheet.** A *sheet* embed now takes its
   > own sheet's accent — pilot `#EF894F`, mech `#7A978A`, crawler `#CE5898`,
   > read from the same `--color-sheet-*` tokens `theme.css` defines. The strip
   > down an embed's left edge is the one element Discord renders that a live
   > sheet also has, and spending it on the sheet's accent is what makes the
   > card read as a sheet rather than as another bot reply. This is still not a
   > bot palette: the values are the design system's, not invented here.
   > Critical state continues to win wherever both apply, and every non-sheet
   > embed is still rust.
5. **Reuse `format.ts` and the existing `LIMIT` budget.** `lookupEmbed.ts`
   already encodes Discord's real limits (25 fields, 1024/field, 6000 total);
   crew boards must respect the same ceiling.

### The one genuinely hard rendering call: alignment

Discord renders embed text in a **proportional** font, so `HP ██████░░░░ 6/10`
on two consecutive lines will not line up. A monospace code fence guarantees
alignment but kills links, colour and inline layout.

**Recommendation: inline fields, no code fence.** Each crewmate is its own
inline field, so there is no cross-column alignment to lose; within one field
every bar is the same glyph count, which is close enough that proportional
spacing does not read as broken. Reserve code fences for anything genuinely
tabular.

> **Verify before locking the glyphs.** `█`/`░` vs `▰`/`▱` vs `●`/`○` render
> differently across desktop, iOS and Android Discord, and differently again in
> light vs dark theme. Screenshot all four before committing to a set — this is
> the same "measure it, don't reason about it" rule the web side follows.

### Mockups

**`/su crew`** — public. The one that has to be good.

```
┃ ⬛ In The Union Now
┃ Tenacity — Crew                          → intheunionnow.com/dashboard/j57x
┃ 4 aboard · Downtime step 2 of 6 · 3 at the table
┃
┃ ROOK · alxjrvs        SPARROW · Kit          — · unclaimed
┃ HP ██████░░░░  6/10   HP ██████████ 10/10    HP ████░░░░░░  4/10
┃ AP ███░░  3/5         AP █████  5/5          AP ░░░░░  0/5
┃ Iron Mongrel          Rainmaker              (no mech)
┃ SP ████████░░  8/10   SP ░░░░░░░░░░  0/10 ✖
┃ HT ▲▲▲░░░  3/6        HT ▲▲▲▲▲▲  6/6 ⚠
┃
┃ Salvage Union · today at 14:02
```

Owner attribution rides in the field name, so **Unclaimed renders as a state**
rather than a blank — the exact hazard `accounts-and-games.md` flags for every
surface reading an owner. `✖` marks destroyed, `⚠` marks heat at maximum.

**`/su me`, not signed in** — ephemeral. Note there is nothing to paste.

```
┃ Not connected
┃ You don't have an In The Union Now account yet.
┃
┃ Sign in with this same Discord account and the bot will
┃ recognise you here automatically — there's nothing to copy
┃ across and no code to enter.
┃
┃ [ Sign in ]  → intheunionnow.com/account
```

**`/su me`, signed in** — ephemeral.

```
┃ Alex — In The Union Now
┃ Linked at sign-in. Discord is the only way in, so this is
┃ always current.
┃
┃ YOUR GAMES (2)
┃ Tenacity   Player · Organizer   ← this channel
┃ Ashfall    Mediator
┃
┃ ON YOUR SHELF (3)
┃ Rook · Sparrow-2 · Iron Mongrel "Bitter"
┃
┃ [ Open ITUN ]  [ Post to channel ]
```

**`/su roll`, in a bound channel** — the entire visible diff is the footer.

```
   before   Salvage Union
   after    Salvage Union · recorded to Tenacity
```

**A Mediator alert** — public, unprompted.

```
┃ ⚠ Tenacity
┃ "The ridge gives way — the crawler takes 4 damage."
┃ Kit · Mediator · 14:07
┃ [ Open Dashboard ]
```

**A proposal** — stretch only.

```
┃ Proposal for @alxjrvs
┃ ROOK — Current HP
┃ 6  →  3
┃ from Kit (Mediator) · Dashboard · 14:09
┃ [ Apply ]  [ Decline ]  [ Open sheet ]
```

---

## 8. Delivery phases

Each phase is a shippable PR. Phase 0 is the only hard prerequisite.

### Phase 0 — Close the hole, open the pipe

- Add the `/bot/*` HTTP route namespace to `convex/http.ts` with bearer-secret
  verification (§3, option A).
- **Add auth to `recordRoll`.** Today it has none (§1b). Non-negotiable, and it
  ships before anything binds a channel.
- Auto-stamp `users.discordId` at sign-in; backfill existing users; retire
  `linkDiscordId` (§4).
- Bot side: extend `config.ts` with `itunSiteUrl` + `itunBotSecret` (both
  **optional** — Solo must keep working), and add a thin client module so tests
  stay offline.
- Render: `ITUN_CONVEX_SITE_URL`, `ITUN_BOT_SECRET` (1Password → Render env).

**Exit:** an integration test proves an unauthenticated `recordRoll` is rejected,
and the bot can round-trip one authenticated call.

> **Built, with one deviation.** The plan said to add `convex` to the bot's
> dependencies. It was not needed and was not added: with the surface exposed as
> HTTP routes, the client is `fetch` and nothing else. The `convex` package buys
> a websocket and reactive subscriptions, which matter only for Phase 5 — adding
> a browser SDK to a Node worker now, for a feature later, is how dependency
> weight accretes unnoticed. Add it when Phase 5 lands, not before.
>
> `recordRoll` was not merely authenticated but moved: it is
> `internal.botClient.recordRoll`, and an **internal** Convex function is
> unreachable from any client whatsoever. That is a stronger fix than a check
> inside a public mutation, because it cannot be undone by someone later
> forgetting the check.

### Phase 1 — Identity ✅

`/su me`, `/su games`. Smallest possible surface that exercises the whole pipe
end-to-end, and it delivers the literal ask ("link to our ITUN account, list
games") on its own. `/su shelf` shipped alongside them — it is the same shape
(personal, ephemeral, needs no binding) and splitting it out bought nothing.

### Phase 2 — Binding ✅

`/su game bind|unbind|info`, the first subcommand **group** on `/su`.
Organizer-gated server-side, with Game autocomplete drawn from the caller's own
games. Binding announces itself publicly: it changes what the channel means for
everyone in it.

### Phase 3 — The read surfaces ✅ (one deferral)

`/su crew` and `/su sheet`. The product payload.

The _Post to channel_ button was **not** built. `/su crew` is public already —
the case it was meant to serve — and adding a stateful component before anyone
has asked to share a sheet is speculative surface. The customId scheme has room
for a `share` action whenever it earns one.

> **Phase 3b — the sheet became a sheet.** `/su sheet` shipped as three fields
> (HP/AP/Class, SP/Heat/Chassis) with `classRef` and `chassisRef` printed as raw
> slugs. It now renders the live sheet region-for-region: resolved and linked
> entity names, abilities grouped by tree, item conditions, the sheet's accent,
> and chassis/class artwork as a thumbnail. Three things landed with it:
>
> - **The crawler is openable.** `botClient.sheet` typed `table` as
>   `'pilots' | 'mechs'`, so the crawler appeared on the crew board and could be
>   opened nowhere. It is communal (no `ownerId`), so it reports no owner rather
>   than an absent one.
> - **The deep links were repointed.** Both surfaces linked
>   `/sheet/<kind>/<appId>`, which resolves out of the **clicker's** IndexedDB —
>   so every link the bot gave a crewmate opened an empty page, silently. They
>   now use `/games/<gameId>/view/<kind>/<convexId>`, the read-only Game view,
>   which is addressed by row id precisely because the viewer has no local copy.
>   `sheet` gained `gameId` to make that addressable. A side effect worth
>   knowing: an **unclaimed** entity is now linkable, because it exists
>   server-side whether or not anybody has claimed it into a browser.
> - **Embed limits are enforced at all.** `gameEmbed.ts` had no `total` in its
>   limits and no enforcement pass, so an oversized embed would have been
>   rejected with a 400 rather than trimmed. `format.ts` now owns the shared
>   caps, `stripDanglingLink`, and a field-shedding `enforceEmbedLimits` applied
>   once in `toEmbed`.
>
> Measured rather than estimated: a fully-linked pilot embed is ~2000 of 6000
> characters, so the 6000 total is not the binding constraint — the
> 1024-per-field cap is, which is what the tree grouping addresses.

### Phase 4 — Roll attribution ✅

Footer + `recordRoll` on `/su roll` (and `/su check`, which existed then and
has since been removed). **Closes #623's exit criterion.**

Two details the plan did not anticipate, both settled in
`commands/rollAttribution.ts`:

- **The reply is not deferred.** The roll is replied to first, exactly as
  before, and the footer is edited afterwards once the recording lands. A dice
  bot must feel instant, and deferring would have made every roll slower for
  everybody — including Solo installs, which get no benefit at all.
- **The re-roll buttons record too.** Attributing only the slash-command form
  would leave the Change Log quietly disagreeing with the channel about what
  happened at the table.

### Phase 5 — Alerts to the channel

The reactive subscription. Separable, and the right thing to defer if the
earlier phases land slowly.

### Phase 6 — Stretch: proposal Apply/Decline

Only after Phase 3 shows the channel is a surface people read.

---

## 9. Risks and things that will bite

| Risk                                                                       | Handling                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **The bot secret is a real bearer credential** (§3A).                      | Named, not hidden. Scope its route namespace to member-level reads + roll recording. Migrate to option B when it earns it. |
| `recordRoll` is currently unauthenticated.                                 | Phase 0, before any binding exists.                                                                                        |
| Convex latency vs Discord's **3-second** ack window.                       | `deferReply()` on every Game subcommand. Non-optional.                                                                     |
| Reference commands regressing when Convex is down.                         | The Solo/Connected/Degraded table (§5) is a test matrix, not prose. `/su lookup` must not import a Convex client at all.   |
| Glyph bars rendering badly on mobile or in light theme.                    | Screenshot four clients before locking the set (§7).                                                                       |
| `mock.module` leaking across bot test files.                               | Known Bun behaviour — restore in `afterAll`, spread the namespace at capture time. Prefer an injected client over mocking. |
| The bot bundles via `bun build --external`; a new dep must be added there. | Moot as built — no dependency was added (see Phase 0). It applies again at Phase 5, which does need `convex`.              |
| Alert subscriptions replaying on restart.                                  | Watermark by `changeLog.ts`; never post an entry older than process start.                                                 |
| Unclaimed entities (`ownerId: null`) rendering as blank.                   | Render **Unclaimed** as a state everywhere (§7 mockup). Same hazard the web surfaces carry.                                |

**Known gap, deliberately left:** `mechStats` derives Max SP and Max Heat
without a `PilotingContext`, so a pilot ability that contributes to the mech it
pilots (or a `perTechLevel` amount) is not counted, and `/su crew` can show a
different maximum than the app does for the same mech. Closing it means
resolving mech→pilot through `softLinks`, whose refs are app-level ids rather
than Convex ids, and threading the piloting pilot's abilities through the
`crew` payload. Worth doing; not worth doing late in the change that introduced
the surface.

Not a risk: **knip**. Verified — its Convex plugin already treats `convex/` as an
entry point, so new server functions do not need `@public` tags.

---

## 10. Decisions wanted before Phase 0

1. **Credential model** — ship option A (shared secret, keeps Render) as
   recommended, or go straight to option B (Discord-signed interactions on
   Convex, likely retires the Render worker)? This is the only choice that
   materially changes the work. _Recommendation: A, with B written down._
2. **Is `/su crew` public by default?** _Recommendation: yes — a crew board only
   pays for itself if the table sees it. Ephemeral-with-share is the fallback if
   channel noise turns out to be the complaint._
3. **Alerts in scope for the first milestone, or deferred to Phase 5 as drawn?**
   _Recommendation: deferred. Phases 1–4 close #623's stated exit criterion
   without it._
