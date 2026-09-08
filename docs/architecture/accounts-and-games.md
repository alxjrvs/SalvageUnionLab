# Accounts, Games & the Live Game Dashboard

> **Status:** Delivery plan for [ADR-030](../adrs/ADR-030-accounts-games-server-of-record.md).
> The ADR records _why_ and _what_; this document records _in what order_ and
> _what breaks_. **Phases 0-6 have landed as a stack of draft PRs** (#609 through
> #645). The server layer, data model and permission rules are complete and
> tested; the surfaces for Phases 3-5 are wired to that data but want a design
> pass before they are called finished.
>
> Read alongside [ADR-021](../adrs/ADR-021-itun-surface-taxonomy.md) (the
> enforcement modes this adds an ownership axis to),
> [ADR-022](../adrs/ADR-022-provenance-log-and-overrides.md) (the Change Log this
> promotes to a sync spine), and [dashboard.md](dashboard.md).

---

## 1. The shape of the change

ITUN today is one person, one browser: entities in IndexedDB, Workspaces
organizing builds, a single-player Dashboard, and one server surface — the
immutable snapshot endpoint.

After this work: Discord-authenticated accounts, **Games** as the shared
container, **Shelves** as the personal one, entity ownership, a distinct Mediator
surface, and a Dashboard that synchronizes a table.

What does **not** change: anonymous Solo play, snapshot sharing, `apps/srd`, the
ADR-021 enforcement modes, and the locked Dashboard canvas.

---

## 2. Decisions

The full decision record is [ADR-030](../adrs/ADR-030-accounts-games-server-of-record.md).
In brief, grouped:

| Area         | Decision                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Truth        | Convex is the server of record; IndexedDB becomes a cache. Offline writes are **blocked**.             |
| Identity     | Discord OAuth only, reusing the bot's existing Discord application.                                    |
| Containers   | **Game** (shared) and **Shelf** (personal). One entity, one container. **Move** sets `gameId`; **copy** mints a new unrelated `COPY OF …`. |
| Roles        | Base role Player \| Mediator, plus an orthogonal **Organizer** flag. Organizer ⇒ no content authority. |
| Cross-player | **Propose → player confirms.** Never a direct write, never force-applied.                              |
| Ownership    | Nullable. Mediator assigns; owners release; **players self-claim what nobody holds**.                  |
| Crawler      | Communal to edit; **the table runner raises and scraps one**. A Game may hold several.                 |
| Joining      | A Game takes a player's pilots and mechs **once it has a crawler**. The table runner is exempt.        |
| Visibility   | Live vitals for all; read-only sheet drill-in; Mediator NPCs hidden.                                   |
| Surfaces     | New Mediator surface absorbs `/encounter`; a **"Crew" dial item** on the player Dashboard.             |
| Anonymous    | Solo stays first-class and needs no account, forever.                                                  |

---

## 3. Three storage modes

Every store, hook, and surface must be legible in all three. This is the largest
source of subtle bugs in the whole plan — check surfaces against the table, not
against intuition.

| Mode             | Who                | Truth        | Reads                 | Writes      | Games  |
| ---------------- | ------------------ | ------------ | --------------------- | ----------- | ------ |
| **Solo**         | not signed in      | IndexedDB    | local                 | local       | none   |
| **Connected**    | signed in, online  | Convex       | reactive subscription | to Convex   | full   |
| **Disconnected** | signed in, offline | Convex, gone | cache                 | **blocked** | frozen |

**Solo is not Disconnected.** Someone who never signs in never sees a banner and
never loses a write.

---

## 4. Delivery phases

Each phase's exit criterion is the next one's precondition.

### Phase 0 — Decide & clear the ground ✅

- ADR-030 written; ADR-001 marked superseded; ADR-022 amended by reference.
- `lib/eldridgeCoast/` deleted — a personal home campaign does not belong in the
  shipped bundle once real Games exist.
- Stale tracker items closed: **#157** (invite codes, superseded by Phase 1) and
  **#165** (assumes a Supabase service-role key and RLS policies).
  **#152 and #156 stay open** — their remaining stories (Downtime, advancement,
  Pushing, Crafting, Salvage) are single-player gameplay mis-filed under
  "Multiplayer", and closing them would destroy live backlog.

### Phase 1 — Accounts, Games & sync ✅

Everything structural, nothing live. The Dashboard stays single-player, which is
what de-risks the rest.

- Convex project, schema, Discord OAuth ✅ (see `apps/itun/convex/`)
- Games: create, rename, delete, invite code, join
- `Workspace` → `Game` + `Shelf` split; nullable `gameId`. **The client cutover
  has now landed too**: the Workspace switcher, list, and assign controls are
  deleted, the Roster/Encounter surfaces resolve through `lib/container.ts`, the
  Starter Set seeds onto the Shelf, and Dashboard dial prefs moved off the
  Workspace record into `cockpitPrefsStore` (localStorage, keyed by container).
  Solo surfaces render unfiltered — see the note in `activeContainerStore.ts`.
- The three storage modes + the **NOT CONNECTED** banner
- Claim-local-data flow on first sign-in
- Move between Shelf and Game (`MoveToContainerControl` — one field, not a copy)
- **Copy to shelf** — mints a NEW `COPY OF <name>` entity, `gameId: null`, with
  no tie to the source or its Game (ADR-030 §2). Not built yet.
- Starter Set re-homed as a Game template, its entities unclaimed
- Account management: profile, My Games, export, delete

**Exit:** two people sign in, one creates a Game, the other joins by code, and
each sees their own entities scoped to it — on two machines. An account can be
fully deleted.

### Phase 2 — Roles & visibility ✅

Capabilities on membership, Organizer transfer, Mediator assignment,
**server-side** authorization on every mutation, read-only crewmate drill-in,
ownership assign/release/reassign, owner chips.

**Exit:** the capability matrix is enforced in Convex, proven by tests that a
Player cannot write a crewmate's pilot and that an Organizer gains nothing over
content by holding the flag.

### Phase 3 — The Mediator surface ✅ (server; screen wants a design pass)

Crew roster with live vitals, the communal crawler, the NPC tray; `/encounter`
absorbed and retired; presence.

### Phase 4 — Alerts & propose/confirm ✅

Proposal states on the Change Log, same-field supersession, player Apply/Decline,
broadcast alerts, and the **Crew** dial item.

### Phase 5 — Synchronized Downtime ✅

Downtime phase as Game state advanced by the Mediator; per-player step completion
visible to the table; crawler upkeep resolved once rather than six times.

### Phase 6 — Discord bot as a Game client ✅ (alerts deferred)

The bot authenticates as a participant rather than an admin; rolls made in
Discord land as Change Log entries.

Built end-to-end: `/su me`, `/su games`, `/su shelf`, `/su crew`, `/su sheet`,
`/su game bind|unbind|info`, and roll attribution on `/su roll` (`/su check`
carried it too, until that command was removed).
The bot reaches Convex through a `/bot/*` HTTP route carrying a bearer
credential that authenticates the **bot**, never the **actor** — every call
still resolves its actor from a linked Discord id and runs the same
`model/permissions.ts` checks the web does.

Two things this phase closed that were not on the checklist. `recordRoll` had
been a **public mutation with no authorization at all**; it is now an internal
function, unreachable from any client. And there is no account-linking step to
build: Discord is the sole auth provider, so the snowflake already sits in
`authAccounts.providerAccountId` and is stamped at sign-in.

**Deferred:** pushing Mediator alerts into the channel, which needs a reactive
subscription rather than request/response. See
[`discord-bot-game-client.md`](discord-bot-game-client.md) for the credential
decision, the command surface, and the remaining phases.

### Phase 7 — The crew roster, and the rules for setting a table up ✅

The design pass Phase 3 deferred, plus the ownership rules it exposed as missing.

- **`GameRoster`** — a Game's crew in the home Roster's own shape: three
  ontology-toned `EntityRow` columns, create CTAs, sheet and Dashboard launches,
  an owner chip per row, and an **UNCLAIMED** stamp seal that opens a pick-up
  confirm. `/games/:id` for any member; `/mediator/:id` opens with it and keeps
  the private instruments below.
- **The table-setup rules** (ADR-030 §5a): the table runner raises and scraps
  crawlers, a Game may hold several, and it takes a player's pilots and mechs
  once one exists.
- **Self-claim** (`ownership.claim`), amending ADR-030 §4.
- **Adoption** — `entityStore.adopt` / `forget` cache a Game row into IndexedDB
  under its own id and drop it again, which is what makes a sheet or the
  Dashboard openable for a character built at somebody else's table.
- **The crawler mirror** — local crawler edits reach the Game as a field merge
  (`patchCrawlerByAppId`), so "players may edit its fields" is true end to end.
- Two live defects found on the way: `crew.vitals` read `currentHp`/`currentSp`
  where the Zod schemas define `currentHP`/`currentSP`, so **every vital on the
  Mediator's crew strip was null** and rendered as an em-dash indistinguishable
  from an undamaged crew; and `proposals.apply` wrote the merged body **without
  parsing it**, so a proposal against a misspelled field added a key nothing
  reads and moved no number. Both fixed, both pinned by tests that build their
  fixtures by parsing the real schema rather than hand-writing field names.

**Closed since, and worth knowing why:**

- **A refused mirror used to be only a console warning** — listed here as a
  known gap on the reasoning that the surfaces avoid offering the actions that
  would be refused, so it was reachable mainly by going around them. That
  reasoning was wrong, and a play session proved it: the refusal did not come
  from a player doing something the UI discouraged, it came from **the data**.
  Duplicate `appId` rows (see below) made `byAppId` throw on every mirrored
  write, and because the local write had already succeeded, every surface went
  on rendering the work as saved while nothing reached the game for the better
  part of an hour. The feedback was "the game mechs didn't save".

  The lesson is that "only reachable by misuse" is not a safety property when
  the trigger can be a row rather than a click. `reportMirrorFailure`
  (`entityBackend.ts`) now warns, reports to Sentry **and** toasts, throttled to
  one message per 30s so a burst reads as one condition.

- **Duplicate `appId` rows are survivable.** Prevention (`appIdTaken` before any
  insert) and repair (`maintenance.dedupeAppIds`) close the front door and clean
  up behind it. This is the third leg: `byAppId` / `crawlerByAppId` no longer
  ask for `.unique()` on an index that was never a uniqueness constraint, so a
  duplicate that reaches them resolves to the **oldest** match and logs rather
  than throwing.

  Worth stating why all three exist. A throw here is invisible — mirrored writes
  are fire-and-forget — so it does not fail the write, it stops the write ever
  reaching the server while every surface keeps rendering it as saved. Refusing
  to sync is a strictly worse answer to "there are two rows" than syncing to one
  of them and saying so. Oldest is chosen to match what `dedupeAppIds` keeps, so
  a write landing before the repair runs is not discarded by it.

- **Soft links mirror.** They were excluded as "derived", which is nearly true
  of a shelf and not true at all of a Game — `listForGame` reads them back, so
  the crew saw the wiring as it stood at claim time and no change after it.
  `entities.upsertSoftLink` / `removeSoftLink` address a link by its endpoints
  (no `appId` needed, and idempotent as a result), and `removeByAppId` /
  `remove` now cascade link pruning the way the client always has.

**Known gaps, deliberately left:**
- **No read-only drill-in.** ADR-030 §5 permits reading a crewmate's sheet;
  `crew.readEntity` exists on the server with no consumer, because ITUN's sheet
  is an editing surface. Rows for entities you do not own therefore offer
  vitals and an owner, but no link.
- **Adopted copies re-sync only on the way in.** Opening a row through the
  roster overwrites this browser's copy from the server, so the crawler a
  crewmate just edited is current when you open it — but a sheet already open
  does not update underneath you.

---

## 5. What breaks

| Site                   | Hazard                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entityStore`          | Write-through to IndexedDB is the single write path for the whole app; the server of record inverts it. Keep the public API identical and swap the backend beneath it.      |
| `activeWorkspaceStore` | **Replaced** by `activeContainerStore`, which persists `shelf` \| `game:<id>`. The "exactly one current container" invariant survives; it is only consulted when Connected. |
| `db/broadcast.ts`      | Cross-tab invalidation is superseded by Convex reactivity **only in Connected mode**. Keep it — Solo needs it.                                                              |
| `ExportBundle`         | `schemaVersion: 1` is a literal. Adding ownership columns is breaking; bump to `2` and keep reading v1 as Solo entities.                                                    |
| Migration v10          | The Default-workspace backfill must become a no-op for anyone who never signs in.                                                                                           |
| Nullable `ownerId`     | Every surface reading an owner must render **Unclaimed** as a state, not a blank or a crash.                                                                                |
| Owner chips            | Pass as a `badge` control from the app — do not teach `component-lib` about users; `apps/srd` must need no change.                                                          |
| PWA + auth             | A token expiring mid-session should present as Disconnected, not as a crash.                                                                                                |
| PII                    | Account deletion, export, and a privacy note are Phase 1 scope.                                                                                                             |
| Snapshots              | None. [ADR-004](../adrs/ADR-004-snapshot-netlify-functions.md) is untouched, and becomes the only unauthenticated surface left.                                             |

---

## 6. External services — operational reference

Everything needed to stand this up, or to work out why sign-in is failing.
Values here are **not secret**: deployment URLs and a Discord client id are
public by design. The client _secret_ lives only on the Convex deployments.

### Convex

|                                       | Dev                                      | Production                                    |
| ------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Deployment                            | `dev/alex-jarvis` (`perfect-donkey-72`)  | `exuberant-porpoise-183`                      |
| Client URL (`VITE_CONVEX_URL`)        | `https://perfect-donkey-72.convex.cloud` | `https://exuberant-porpoise-183.convex.cloud` |
| HTTP actions (`VITE_CONVEX_SITE_URL`) | `https://perfect-donkey-72.convex.site`  | `https://exuberant-porpoise-183.convex.site`  |
| `SITE_URL` (the **frontend** origin)  | `http://localhost:5173`                  | `https://intheunionnow.com`                   |

Project: `alex-jarvis:suref-itun` ·
[dashboard](https://dashboard.convex.dev/t/alex-jarvis/suref-itun)

### Convex error reporting — a dashboard toggle, not code

Every other surface in this repo reports errors through a hand-written
`observability.ts` (`apps/srd`, `apps/itun`'s browser bundle and Netlify
Functions, `apps/discord-bot`, `apps/su-assets`). **Convex is deliberately not
one of them.** It has a first-party
[Exception Reporting integration](https://docs.convex.dev/production/integrations/exception-reporting)
that is enabled in the Convex dashboard and needs no application code at all.

That is not merely the tidier option — it is the only one that covers the
surface:

- **Queries and mutations cannot report from inside a function.** They run in
  Convex's deterministic runtime, which has no `fetch` and no network egress by
  design. That is most of `convex/` (`games.ts`, `invites.ts`, `proposals.ts`,
  `crew.ts`, `ownership.ts`, …), so a code-level SDK could never see the bulk of
  the errors we would be adding it for.
- **`@sentry/node` does not run there either.** The default Convex runtime is
  not Node; this deployment has no `'use node'` actions, so adding the Node SDK
  would mean converting modules to the Node runtime purely to instrument them.
- **What is left is HTTP actions** (`http.ts`, `botHttp.ts`), where a
  hand-rolled `fetch` to Sentry's ingest endpoint would duplicate a built-in
  that already tags events with function name, function type, runtime, request
  id, deployment name, environment tier, and the caller's `tokenIdentifier` —
  none of which application code can reconstruct.

So the deliverable here is the runbook, not a module.

**Enabling it** (a human has to click this; it cannot be scripted from the
repo):

1. Create a Sentry project in the `susrd` org — **EU region**
   (`https://de.sentry.io`), like every other project here — and set its
   platform to **Node.js**, which is what Convex's integration expects for
   stack-trace processing. Slug: `itun-convex`, sitting alongside `itun`
   (browser) and `itun-functions` (Netlify). **This step is done** — the
   project exists (see the registry in
   [agent-tooling.md](agent-tooling.md)). Whether step 2 has been clicked is
   only visible in the Convex dashboard, so check there rather than assuming.
2. Convex dashboard → the deployment → **Settings → Integrations → Sentry** →
   paste that project's DSN. Do it **per deployment**: `dev/alex-jarvis` and
   `exuberant-porpoise-183` are configured separately, and production is the one
   that matters.
3. Optionally add a tag to distinguish the two deployments in Sentry.

**Two caveats worth knowing before you go looking for events:**

- **Exception Reporting is a Convex Pro feature.** On the free plan the Sentry
  card is not available, and the honest state of this repo is then "Convex
  errors are visible in the Convex dashboard's function logs only". Do not
  paper over that with code — see above for why the code would not work.
- Events take a minute or two to propagate, and Convex does not expose the
  Sentry SDK for customisation. There is no release tagging to wire up, so
  Convex errors will not carry a commit SHA the way the browser and Worker
  surfaces do.

**Status: DELIVERING since 2026-08-12**, confirmed end to end — a forced error
was seen in `convex logs` and then in Sentry as `ITUN-CONVEX-1`, the first event
that project had ever received. Step 2 above (pasting the DSN) is what had been
missing; the Pro-plan caveat turned out not to apply.

It forwards `ArgumentValidationError` as well as handler throws, which was an
open question until the probe answered it.

**How it was wrong for a week, because the shape recurs.** This section said
"enabled" from 2026-08-05, recorded as a status the moment the *Sentry project*
was created — step 1 of two. Nobody clicked step 2, and nothing about the result
looked different: a reporting integration that reports nothing is
indistinguishable from a healthy one with no errors. It stayed that way through
39 failed `entities:upsertByAppId` mutations in a single evening, every one of
which should have landed there, and the incident surfaced instead as a Discord
message from a player. `tools/check-observability.ts` exists to close exactly
this trap for the browser SDKs; there is no equivalent here, because "zero
events" is also what a healthy quiet week looks like, so it cannot be asserted.

**So verify by probe, never by status line.** Force an error, then check both
channels — the deployment log is the ground truth and Sentry is the thing being
tested:

```bash
cd apps/itun
CONVEX_DEPLOYMENT=dev:perfect-donkey-72 bunx convex run --prod \
  maintenance:dedupeAppIds '{"apply":"not-a-boolean"}'      # forces one error
bunx convex logs --deployment alex-jarvis:suref-itun:prod --history 6 --jsonl
```

then <https://susrd.sentry.io/issues/?project=itun-convex>. In the log but not
in Sentry means it has stopped delivering again.

Do not treat a quiet `itun-convex` as evidence that the backend is healthy.

**Events arriving is not the same as anyone reading them.** There is no alert
rule on this project yet, and Sentry's default is to collect silently — which
is how an evening of 39 backend errors reached a player before it reached us.

#### What reaches Sentry, and what reaches the player

Convex splits everything `convex/` can throw in two, at the wire, and the split
is not configurable:

| thrown              | the client receives                       | good for                       |
| ------------------- | ----------------------------------------- | ------------------------------ |
| `ConvexError`       | its `data`, intact                        | refusals the rules make        |
| anything else       | `"[CONVEX M(fn)] […] Server Error"`        | defects nobody planned for     |

Both still reach Sentry and the function logs. The difference is entirely about
what a **player** may see, and the repo takes a deliberate position on it:

- **`NotAuthorized` extends `ConvexError`** (`convex/model/permissions.ts`), so
  every authorization message — around thirty-five of them — is copy that
  actually arrives. Until 2026-08-05 it did not: each one was written, thrown,
  and discarded at the boundary, and a player who tried something the rules
  refuse got the same opaque string as a crash.
- **Everything else stays a plain `Error`.** A Zod parse failure or a broken
  invariant is not a message to show anyone; it belongs in the logs.

On the client, `src/lib/connection/serverError.ts` is the only sanctioned way to
ask which one you have (`serverMessage` / `isServerRefusal`). Never string-match
`'Server Error'` at a call site, and never render `String(err)` from a mutation —
that string is the redacted one.

#### Repairing duplicated app ids

`convex/maintenance.ts` holds operator-only repairs, reachable through
`bunx convex run` and not from any client. The one that exists today undoes the
damage described under "Claiming twice" in `convex/entities.ts`: rows sharing an
`appId`, which make `byAppId`'s `.unique()` throw and so break every mirrored
write for that entity, permanently and silently.

```bash
# report only — changes nothing
bunx convex run maintenance:dedupeAppIds --prod
# then, having read the report
bunx convex run maintenance:dedupeAppIds '{"apply": true}' --prod
```

It keeps one row per app id (an owned row over an unclaimed one, then the most
recently written) and reports how many `changeLog` rows — audit history and
pending Mediator proposals alike — still point at a copy it would delete. Those
address entities by Convex id rather than `appId`, so they do not follow the
survivor.

### Netlify

| Site               | Serves                           | Notes                                                                                                                                        |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `in-the-union-now` | `https://intheunionnow.com`      | ITUN. **The production origin is the custom domain, not the `.netlify.app` subdomain** — `SITE_URL` and the OAuth redirect must both use it. |
| `suindex`          | `https://salvageunion.io`        | `apps/srd`. No accounts, ever.                                                                                                               |
| `su-assets`        | `https://assets.salvageunion.io` | Entity artwork. Unrelated to accounts.                                                                                                       |

### Discord

One application covers both the bot and web sign-in, so players meet a consent
screen they already recognise and there is one credential to rotate. Resetting
the OAuth2 client secret does **not** disturb the bot token — they are separate
credentials on the same app.

Each deployment needs its **own** redirect URI, and Discord permits several, so
adding one is additive rather than a swap:

```
https://perfect-donkey-72.convex.site/api/auth/callback/discord      (dev)
https://exuberant-porpoise-183.convex.site/api/auth/callback/discord (prod)
```

The path is not arbitrary: `@convex-dev/auth` mounts callbacks under
`/api/auth/callback/` and appends the provider id, which `@auth/core` declares
as `discord`.

### Required deployment variables

**All three, or sign-in fails**, per deployment:

```bash
bunx convex env set AUTH_DISCORD_ID     <client-id>
bunx convex env set AUTH_DISCORD_SECRET <client-secret>
bunx convex env set SITE_URL            <frontend origin>
# add --prod to target production
```

`SITE_URL` is the one that bites. It is the **frontend** origin, _not_
`VITE_CONVEX_SITE_URL`, nothing prompts for it, and omitting it fails with an
opaque `Missing environment variable SITE_URL` 500 from the OAuth callback
rather than anything pointing at configuration.

**For the Discord bot** (ADR-030 Phase 6), one more on the Convex deployment and
two on the bot's Cloudflare Worker (set with `wrangler secret put`; these were
Render env vars until that account was deleted on 2026-09-01, and were never
actually set there — see the P5 section of the cutover doc):

```bash
# Convex — enables the /bot/* route. UNSET disables the whole surface, so a
# deployment that has not opted in cannot be talked to by a bot at all.
bunx convex env set ITUN_BOT_SECRET <a long random string>

# The bot Worker (su-discord-bot) — both, or the bot stays in Solo mode.
ITUN_CONVEX_SITE_URL=https://<deployment>.convex.site
ITUN_BOT_SECRET=<the same value>
```

`ITUN_CONVEX_SITE_URL` is the **HTTP-actions** origin (`.convex.site`), not the
client URL (`.convex.cloud`) and not the web origin. Getting it wrong presents
as every Game command reporting the deployment unreachable — which is honest but
points at the network rather than at the typo.

The secret is a **bearer credential**: whoever holds it can act as any Discord
user who has linked an account. That is bounded (it cannot invent a membership,
reach an unlinked account, read somebody's shelf, or see `encounterNpcs`) but it
is real. Store it in 1Password, never in git, and rotate on any suspicion.

### Verifying a deployment without signing in

Curl the callback. The status distinguishes all three failure modes:

| Result                                 | Means                                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| **302** → your `SITE_URL`              | Correctly configured.                                      |
| **500** `Missing environment variable` | `SITE_URL` unset.                                          |
| **404**                                | Auth routes not mounted — check `convex/http.ts` deployed. |

Always check a bogus provider too (`/api/auth/callback/bogusprovider` → **500**).
Without that control, a router answering everything looks identical to one
correctly configured for Discord.

```bash
curl -s -D - -o /dev/null https://<deployment>.convex.site/api/auth/callback/discord | grep -i location
```

### Switching production on

Production builds in **Solo mode** until `VITE_CONVEX_URL` is set on the Netlify
site — which is safe and deliberate, not an outage: a build with no Convex URL
is the pre-accounts app, fully working. To switch accounts on:

1. Add the prod redirect URI to the Discord application (above). **Done.**
2. Set `VITE_CONVEX_URL=https://exuberant-porpoise-183.convex.cloud` on the
   `in-the-union-now` Netlify site (production context, `builds` scope) and
   redeploy. **Done** — it is a build-time variable, so it only takes effect on
   the next deploy, not immediately.

> **Note the two different origins.** That site also carries a pre-existing
> `VITE_SITE_URL` of `https://in-the-union-now.netlify.app`, while the primary
> domain — and Convex's `SITE_URL` — is `https://intheunionnow.com`. Sign-in
> therefore returns a visitor to the canonical domain even if they started on
> the `.netlify.app` subdomain. That is defensible, but it is a difference
> somebody will eventually trip over, so it is written down rather than left to
> be rediscovered.

Reversing it is equally simple: unset the variable and production returns to
Solo, with every local build intact.

### Secrets

Never commit the client secret. `.env.local` is gitignored and holds only the
non-secret deployment URLs. When reading a value back, pipe it — do not echo it
into a terminal or a transcript. `bunx convex env get` prints in the clear, so
prefer testing presence by length:

```bash
bunx convex env get AUTH_DISCORD_SECRET | tr -d '[:space:]' | wc -c
```

Exit code is **not** a presence check: `convex env get` exits 0 for a variable
that does not exist.

**`convex env list` prints EVERY value in the clear.** Not the names — the
values. It will dump `JWT_PRIVATE_KEY` and `AUTH_DISCORD_SECRET` in full, and
this has already happened once: run unredirected while checking whether the bot
credential was set, it put both into a transcript and forced a rotation of both.
The names alone are worth having, so ask for only those:

```bash
bunx convex env list --deployment-name <name> | cut -d= -f1
```

Read the **dashboard** instead when you want to confirm a variable exists — it
masks values by default.

### Rotating `JWT_PRIVATE_KEY` / `JWKS`

Rotating the signing keypair **signs every user out**. That is inherent, not a
bug — old sessions were signed by the key you just replaced.

The two must be generated as a pair and written together, in the format
`@convex-dev/auth` expects, or sign-in breaks in the quiet way this document
already warns about:

| Variable          | Format                                            |
| ----------------- | ------------------------------------------------- |
| `JWT_PRIVATE_KEY` | PKCS8 PEM, newlines replaced by **spaces**, trimmed |
| `JWKS`            | `{"keys":[{"use":"sig", …public JWK}]}`            |

**Pipe the value in on stdin; never pass it as an argument.** Two separate
failures make this non-negotiable, both observed:

- the PEM begins `-----BEGIN`, which the CLI parses as **flags** — the command
  simply fails;
- Node's `execFileSync` embeds the whole command line in its **error** message,
  so a failure prints the private key even when stdout and stderr are
  suppressed. Suppressing output is not enough; keep the secret out of `argv`.

```bash
printf '%s' "$PEM" | bunx convex env set JWT_PRIVATE_KEY --deployment-name <name>
```

**Verify against the public endpoint, which needs no secret.** Convex serves the
public half, so the modulus must visibly change:

```bash
curl -s https://<deployment>.convex.site/.well-known/jwks.json
```

Compare `n` before and after. Unchanged means the write did not land and the old
key is still live — which looks identical to success from the CLI's side.

### Rotating `AUTH_DISCORD_SECRET`

Resetting it in the Discord portal invalidates the old value **immediately**, so
Discord sign-in is broken from that moment until Convex is updated. Have the
update command ready first, then reset, copy, and run it back to back.

Clipboard → stdin keeps it out of `argv`, shell history and transcripts:

```bash
pbpaste | tr -d '\n' | bunx convex env set AUTH_DISCORD_SECRET --deployment-name <name>
```

Guard on **length 32** before writing. A Discord client secret is 32 characters;
if the copy silently failed, refusing beats writing garbage into production auth
and rediscovering it later as an unexplained login failure.

Only a real sign-in proves it. Nothing server-side can compare the stored secret
against the one Discord now holds.
