# Cloudflare Cutover

The executable plan for [ADR-033](../adrs/ADR-033-cloudflare-hosting.md) —
retiring Netlify and Render in favour of Cloudflare Workers, R2 and Workers
Static Assets. Hard cutover, no rollback. Convex stays.

**ADR-033 holds the decisions and their reasoning. This document holds the
sequence, the gates and the progress.** Supersedes issue #830, which remains open
for discussion history and should not be executed from.

Drafted against `1366cfdf` on 2026-08-18. Cloudflare and Discord platform limits
verified against vendor documentation on that date; repository claims read from
source.

---

## The rule that governs everything else

> **A failed gate halts the phase.**
>
> No gate is worked around, relaxed, or retried with different parameters to
> obtain a pass. No later phase begins while an earlier gate is red. Report the
> failure and stop.

There is no rollback. Every gate below is written so that it can fail, and a gate
that cannot fail is not a gate. If a gate looks wrong, change it in a PR and say
why — do not route around it in the moment.

---

## Progress

Update this table as part of each phase's PR. It is the only place that answers
"which phase are we on".

| Phase | What                                     | Reversible | Status                    |
| ----- | ---------------------------------------- | ---------- | ------------------------- |
| P0    | Port the CI guards                       | yes        | **done** — 19 guard tests |
| P1    | Export `lp-assets`, restore ingest tool  | blocking   | **done** — 57/57 verified |
| P2    | Measure the bot on real workerd          | throwaway  | **passed** — see Appendix |
| P3    | R2 `SnapshotStorage`                     | yes        | **done** — 20/20 R2 RAW   |
| P4    | Three web surfaces on `workers.dev`      | yes        | **done** — all three live |
| P5    | Bot on HTTP interactions                 | **reversible** | **LIVE on Cloudflare** (2026-08-19) — Discord validated the endpoint |
| P6    | Data sync and write freeze               | **no**     | **built, not activated** — bulk sync done (45/45 verified by content); freeze code merged and OFF. Delta never run; reconciled by measurement on 2026-08-31 instead — 43/45 resolve on production, the other 2 exported to disk. See P8 |
| P7    | Cutover                                  | **no**     | **DONE** — `intheunionnow.com` live 2026-08-19; `salvageunion.io` + `assets.salvageunion.io` live **2026-08-31 03:52:49Z**. Both zones active on Cloudflare; post-flip gate all-pass |
| P8    | Decommission and tooling cleanup         | **no**     | **mostly done** — the repo is clean of Netlify/Render (config, functions, deps, guards, docs), and the **Render account was deleted 2026-09-01**. Only the Netlify account and its three sites remain |

**"Built" is not "activated", and for P6 the difference is the whole point.**
The write freeze ships as code that is **off** (`SNAPSHOT_WRITES_FROZEN` unset),
because turning it on stops sharing for real users. Activating it is a P7 step at
−1 h, not something a merge should ever do. The same applied to P7's staging while it was staging: the
zones existed and answered on their assigned nameservers before the live
delegation moved, so nothing customer-facing had moved yet, and the single
irreversible act was the nameserver flip.

> **That flip has happened.** `intheunionnow.com` went live 2026-08-19 and
> `salvageunion.io` + `assets.salvageunion.io` on 2026-08-31; the progress table
> above marks P7 **DONE**. The paragraph above is preserved as the reasoning
> that shaped the phase, in the past tense. It sat here in the present tense for
> months, eight lines below a table saying the opposite, so a reader asking "are
> we cut over?" got both answers from the document designated as authoritative
> on exactly that question.

**Account:** everything runs on the existing `alxjrvs@gmail.com` account
(ADR-033 §6). A dedicated account was considered and declined; the residue is a
CI token whose blast radius is that whole account.

**R2 is enabled — this section previously said it was not, and blocked P3/P6 on
it.** The operator completed the checkout (it needed a billing address and two
consent checkboxes, which is why an agent could not do it). Both buckets exist
and are in use:

| Bucket              | Holds                          | Verified                          |
| ------------------- | ------------------------------ | --------------------------------- |
| `su-lp-assets`      | licensed entity artwork        | 57/57 objects; Worker serves 200   |
| `su-itun-snapshots` | shared character snapshots     | 45/45 copied, compared by content   |

There is a third bucket on the account, `optfall-card-faces`, belonging to an
unrelated project — same shared-account consequence as the Workers below.

**What is actually on the account** (checked in the dashboard 2026-08-18, after
an earlier claim of "nothing" turned out to be an inference rather than a
measurement — see ADR-033 §6):

| Resource            | State                                                     |
| ------------------- | --------------------------------------------------------- |
| Workers             | RANDSUM's two (`randsum-rdn`, `randsum-site`) **plus our four** — `su-srd`, `su-itun`, `su-assets`, `su-discord-bot` |
| `workers.dev`       | **already registered — `alxjrvs.workers.dev`**             |
| KV namespaces       | none                                                       |
| D1 databases        | none (see §10 — the Convex→D1 move is a follow-up)         |
| R2                  | **enabled** — 3 buckets, 2 of them ours                    |
| Zones               | 4 — `optfall.com`, `randsum.dev`, **`salvageunion.io`**, **`intheunionnow.com`** (the last two pending nameservers) |

Two consequences. The Free quota is **shared with a live project**, though both
sides are far from the ceilings. And preview URLs come from the existing
subdomain (`<worker>.alxjrvs.workers.dev`) — there is one per account, and
renaming it would move RANDSUM's Workers.

---

## Measured facts

Do not re-derive these; do re-verify them if more than a release cycle has
passed. The probe that produced them is in the Appendix.

| Quantity                             | Measured                | Free limit | Used   |
| ------------------------------------ | ----------------------- | ---------- | ------ |
| Worker size, compressed              | 549.6 KiB               | 3 MB       | 18%    |
| Worker size, uncompressed            | 3,061 KiB               | 64 MB      | 5%     |
| Startup, reported by Cloudflare      | **141 ms**              | 1,000 ms   | 14%    |
| Startup, local workerd               | 28–32 ms (4 cold starts)| —          | —      |
| Warm request CPU                     | below timer resolution  | 10 ms      | —      |
| Bot CPU, real `/su roll` in Discord  | **951 µs** (19 invocations, 0 errors) | 10 ms | **10%** |
| `preload('all')` under Bun           | 81.6 ms                 | —          | —      |

**These describe the BOT probe (P2), not every Worker.** Two rows worth adding
because their absence was mistaken for coverage:

| Quantity                                  | Measured                | Free limit | Used   |
| ----------------------------------------- | ----------------------- | ---------- | ------ |
| `su-itun` size, compressed                | **1,185 KiB**           | 3 MB       | **39%** |
| `su-discord-bot` size, compressed         | 659 KiB                 | 3 MB       | 21%    |
| `su-assets` size, compressed              | 105 KiB                 | 3 MB       | 3%     |
| `renderOgImage`, LOCAL (Apple silicon)    | 47.6 ms cold / ~15 ms warm | 10 ms CPU | **UNKNOWN on workerd** |

The last row is an **open question, not a measurement of production**. The
og:image renderer was never sized against the CPU ceiling — it does not appear
above because it did not exist when that probe ran — and a local benchmark says
nothing definitive about workerd. It matters because a CPU-limit kill is not
catchable, so the renderer's own fallback cannot run.

The runbook for settling it is in the doc block above `ogImage` in
`apps/itun/src/worker/index.ts`, and a `console.log` there makes the tail entry
greppable. **Do this before assuming the unfurl works**; do not rewrite the
publish path on the strength of the local number alone.
| All 27 data JSON files, gzipped      | 268 KB                  | —          | —      |
| Workers Free requests / subrequests  | —                       | 100k/day · 50 | —   |
| KV global propagation                | up to 60 s              | —          | —      |

Cloudflare's 3 MB Worker limit is measured **after compression**; the
uncompressed ceiling is 64 MB and is not a constraint here.

Workers freeze `Date.now()` between I/O as a Spectre mitigation, so per-request
CPU cannot be timed from inside a Worker. The authoritative reading is
`cpuTime` from `wrangler tail` against a deployed Worker.

---

## Phases

### P0 — Port the CI guards · reversible · ½ day

Three tools READ `netlify.toml` at the time this phase was written, and each
exists because of a documented silent-production incident. A hard cutover
deletes that file, so they were ported **first**, not during. (That file no
longer exists anywhere in the tree; this phase is complete.)

- `tools/check-observability.ts` — CSP `connect-src` per browser app. It also
  carries a `netlifyBundled` flag per surface and a hardcoded `FUNCTION_DIRS`.
- `tools/check-bun-version.ts` — the `BUN_VERSION` pin.
- `tools/check-convex-parity.ts` — asserts the build command refuses to ship
  without `CONVEX_DEPLOY_KEY`. That command moves into Actions, making this the
  sharpest of the three.

`FUNCTION_DIRS` is a **retirement, not a port** — a Worker declares one entry
point, so the failure class it guards ceases to exist. Delete it deliberately,
with the reason recorded in the diff.

`tools/check-ci-aggregator.ts` (#812) fails when a job is missing from the
`quality-checks` aggregate's `needs:`. It will fire as jobs change. That is
correct; do not suppress it.

**Gate — met 2026-08-18**

- [x] `bun run check:all` green. *Gate wording amended:* it asked for a
      `wrangler.jsonc` to be present, which was the wrong test — the guards do not
      read one. Each guard instead resolves its property from whichever source
      exists, and the tests below drive it from the Cloudflare source with the
      Netlify one deleted, which is the stronger assertion.
- [x] Each ported guard demonstrated to **fail** when its property is removed —
      19 tests across three files, all mutating the real tree and restoring it.
- [x] The `FUNCTION_DIRS` retirement carries its reasoning in the diff.

The rule each guard now follows, and the distinction the whole phase turns on:

| State                                    | Verdict                     |
| ---------------------------------------- | --------------------------- |
| Config file absent                       | surface retired → skip      |
| Config file present, property missing    | **fail** — misconfiguration |
| No source anywhere carries the property  | **fail** — unguarded        |

Two findings while porting, both recorded in the tests:

- `apps/srd/public/_headers` **already exists**, carrying CORS for the JSON
  endpoints and no CSP. So "a `_headers` file exists" must not imply "it declares
  the policy" — the rule is *at least one source declares a CSP, and every source
  that declares one must permit the Sentry origin*. A first attempt conflated
  those and failed on the committed tree.
- `check-convex-parity.ts` now names `.github/workflows/deploy-cloudflare.yml`
  **before that workflow exists**, so P4 has to satisfy the guard rather than the
  guard being retrofitted afterwards. The "neither source present" case fails
  loudly, which is what closes the window where nothing asserts it.

### P1 — Export `lp-assets` and restore its ingest tool · blocking · 1 day

Do this whether or not the migration proceeds. It depends on no other decision.

> The **export** half needs nothing from Cloudflare and can start immediately.
> Seeding R2 happens in P6 and needs R2 enabled on the account first.

Once Netlify is gone, R2 becomes the only copy of licensed artwork that cannot
enter this repository. An export gives a second.

- Restore `tools/upload-lp-assets.ts` from `8b678bbd` — it is the restore path.
- Write `tools/export-lp-assets.ts` as its mirror.
  `tools/convert-lp-assets-to-webp.ts` already has the scaffold:
  `netlify blobs:list lp-assets --json` → keys → `blobs:get`.
- Store the export encrypted, off Netlify, outside this repository.

**Gate — met 2026-08-18, one item deferred**

- [x] Export object count equals the `blobs:list` manifest count — **57/57**,
      30,858,850 bytes, 57 distinct SHA-256 digests (no accidental duplicates).
- [x] Every key's SHA-256 matches a fresh re-download. The tool re-downloads
      **every** object and compares; it is not a spot check, because the failure
      being guarded against is a silently truncated stream, which yields a file
      that exists and has a plausible size and is not the artwork.
- [ ] **Deferred: restore rehearsal.** Restoring into a throwaway Blobs store
      would need a second Netlify site, and Netlify is being retired. The
      equivalent rehearsal is seeding R2 from this export in P6, whose gate
      already reconciles per-key hashes against `manifest.json`. Recorded rather
      than silently dropped — until P6 runs, the restore path is *written and
      unexercised*.
- [x] The export lives outside Netlify and outside this repository. Operator
      holds the archive; `manifest.json` travels with it so a restore verifies
      against the list captured at export time rather than a fresh `blobs:list`
      taken after something has already gone wrong.

`tools/upload-lp-assets.ts` is restored from `8b678bbd` unchanged — it *is* the
restore path, and #725 deleted it as dead code while it was the store's only
ingest mechanism.

### P2 — Measure the bot on real workerd · throwaway · **passed**

Ran 2026-08-18. See Measured facts and the Appendix. Cloudflare's deploy-time
startup enforcement accepted the probe at 141 ms; the probe was deleted
afterwards.

Four constraints surfaced that Phase 5 must honour:

1. **Module scope forbids timers, async I/O and randomness.** `new REST()` throws
   with *"Disallowed operation called within global scope"* — its constructor
   registers sweeper timers. Construct it lazily inside the handler. This also
   applies to module-scope `initObservability()`.
2. **`ButtonStyle` is exported by `discord-api-types`, not `@discordjs/builders`.**
   The import rewrite is not a pure name-for-name swap.
3. **Zod's `jitless` config is load-bearing for Workers**, not only for CSP.
4. **Top-level `await` works at module scope**, which is what allows the preload
   to be charged against the 1 s startup budget instead of the 10 ms request
   budget.

**Residual, deferred to P5:** per-request `cpuTime` read from `wrangler tail`
against a deployed Worker carrying the real command handlers.

### P3 — R2 `SnapshotStorage` · reversible · ½ day

> **Prerequisite: R2 must be enabled** on the Cloudflare account
> (`wrangler r2 bucket list` currently returns *"Please enable R2 through the
> Cloudflare Dashboard"*, code 10042). KV and D1 are already available.

`SnapshotStorage` is three methods with two existing implementations, so this is
a drop-in third. Run the **existing**
`apps/itun/netlify/functions/__tests__/snapshot.test.ts` against it by swapping
the injected storage — the suite becomes a conformance suite at no cost.

Then add the test that justifies ADR-033 §3: publish, immediately retrieve, from
a different colo. Run it against both R2 and KV.

Revisit the rate limiter here. It is a module-scope `RateLimiter{10/min}` keyed
on `x-nf-client-connection-ip`, already approximate, behind an enforced 256 KB
payload cap. It is decorative. Either drop it and rely on the cap, or use
Cloudflare's Rate Limiting binding. **Do not port the in-process version** — it
would look like a control without being one.

**Gate — met 2026-08-18, with one item reframed**

- [x] The existing snapshot suite still passes unmodified. **Reframed, and the
      reframing is the point:** that suite runs entirely against
      `InMemoryStorage`, so re-running it against R2 would have meant rewriting
      it — and it is only sound in the first place if the implementations agree.
      So the contract is now asserted once, in
      `src/lib/snapshot/__tests__/storageConformance.test.ts`, and **every**
      implementation is driven through it (18 tests, 9 per backend). A new
      backend adds a row and nothing else.
- [x] Publish → immediate retrieve, **20/20 against a real R2 bucket with no
      delay**. This is the measurement ADR-033 §3 rests on.
- [x] ADR-033 §3 stands on that evidence. The KV comparison was **not** run, and
      that is deliberate: Cloudflare documents the behaviour (up to 60 s global
      propagation, cached negative lookups), the publish flow reads a key twice
      before creating it, and demonstrating the failure would mean publishing
      real snapshots into a store chosen to lose them. Documented behaviour plus
      a measured alternative is sufficient; a staged outage is not.
- [x] Rate limiter: **decided — do not port it.** See below.

**Buckets created:** `su-itun-snapshots`, `su-lp-assets`.

**Rate limiter.** `snapshot-publish` carries a module-scope
`RateLimiter{10/min}` keyed on `x-nf-client-connection-ip`. It is already
approximate on ephemeral Netlify Function instances and would be equally so
across Workers isolates, and it sits behind an enforced 256 KB payload cap that
does the actual storage-amplification work. Porting it would produce something
that *looks* like a control without being one.

The decision is to replace it with Cloudflare's Rate Limiting binding when the
Worker routes land in **P4**, and to drop the in-process version at that point
rather than carrying both. Recorded here so P4 cannot quietly port it by
reflex.

**What R2 deliberately does not change.** `onlyIfNew` remains a check-then-set,
identical to the Netlify implementation, so the two are interchangeable and the
conformance suite can hold them to one contract. R2 supports a genuinely atomic
conditional put that would close the remaining race — worth doing, but as its
own change: altering the contract and porting the platform together would leave
any behaviour difference with two possible causes.

### P4 — Three web surfaces on `workers.dev` · reversible · 2 days

Everything except DNS runs in parallel with production, at zero customer
exposure. This is the acceptance gate for the whole migration.

Register the `workers.dev` subdomain on the account first. It is account-scoped
and effectively permanent — a one-way door rather than a blocker, so choose the
name deliberately.

One enabling change:

- `apps/srd/playwright.config.ts` hardcodes `localhost:4321`. Give it the
  `E2E_BASE_URL` support `apps/itun` already has.

**`ASSET_BASE_URL` is deliberately NOT made env-overridable**, reversing an
earlier note in this plan. The reasoning it was written on does not survive
contact:

- During the parallel phase, previews pointing at `assets.salvageunion.io`
  resolve to the live Netlify artwork, so the artwork path *is* exercisable.
- After the flip that hostname becomes the Worker, with no app change. The
  constant is already correct in both states.
- Verifying the Worker **directly**, by hash-comparing what it serves against the
  P1 export manifest, is stronger evidence than routing an app through it: it
  covers all 57 objects rather than whichever the page happened to render.

Against that, an env override means mutable module state in a pure data package
consumed by four runtimes (SSG under Bun, two browser bundles, and workerd), each
with a different notion of where an environment lives. Not worth it for
verification that is better done another way.

### srd — done 2026-08-18

Deployed at `su-srd.alxjrvs.workers.dev`. **2,046 assets, no Worker script at
all** — srd is fully static (ADR-031), so Cloudflare serves `dist/` directly and
putting a script in front of 1,039 pages would buy nothing.

- **8/8 Playwright tests pass against the live deployment**, via the
  `E2E_BASE_URL` support added to `apps/srd/playwright.config.ts` — the real
  suite unmodified, which is the only version of that assertion worth making.
- Verified on live responses: `/` 200, entity page 200, JSON endpoint 200,
  **missing page 404**, `sitemap.xml` → `sitemap-index.xml` 301.
- CSP served and carrying the Sentry **EU** ingest origin; HSTS,
  `X-Frame-Options: DENY`, `nosniff` all present.
- `/assets/*` immutable for a year; HTML `max-age=0, must-revalidate`; JSON
  endpoints CORS-open with `application/json`.

**`not_found_handling: "404-page"`, not `"single-page-application"`.** srd is
pre-rendered, so a miss is genuinely a miss. SPA mode would answer 200 with HTML
for every typo'd URL — telling crawlers that 1,039 real pages and infinitely
many wrong ones are equally valid. Verified live rather than assumed.

**`_headers` and `_redirects` now carry what `netlify.toml` used to.** Both hosts
read the same file format, so during the parallel phase they serve identical
rules — which is what makes the comparison meaningful instead of a comparison of
two different configurations.

**The output-snapshot gate caught the change, as designed.** Adding `_redirects`
and growing `_headers` altered the emitted file set; `bun --filter srd gate`
failed, and the re-blessed diff is exactly two lines — one new file, count
2050 → 2051, **`html: 1039` unchanged**. That diff is the reviewable statement
that no page changed.

**One test of my own failed correctly.** `check-observability-csp.test.ts`
asserted that srd's `_headers` contained no CSP — true when written, false the
moment the policy moved there. The rule it was protecting is still right; the
test was anchored to a real file that was always going to change mid-migration.
It now constructs the case instead of reading it.

### su-assets — done 2026-08-18

Deployed at `su-assets.alxjrvs.workers.dev`, bound to the `su-lp-assets` R2
bucket seeded from the P1 export.

- **57/57 objects byte-identical through the deployed Worker**, SHA-256 compared
  against `manifest.json`. This doubles as the restore rehearsal P1's gate
  deferred: the export really does reconstitute the store.
- Headers verified on the live response, not read off config: `image/webp`,
  `public, max-age=31536000, immutable`, `access-control-allow-origin: *`, and
  the full #778 security set including HSTS.
- Guards verified live: missing key 404, unlisted extension 404, dotfile 404,
  `POST` 405.

**One live/local difference worth knowing.** An encoded-slash traversal
(`/a/..%2f..%2fb.webp`) returns **400 at Cloudflare's edge**, before the Worker
runs — the handler's own guard returns 404 for the same input in tests. Both are
refusals and the edge one is earlier, so the guard is defence-in-depth rather
than the only line. Do not "fix" the test to expect 400: it exercises the
handler, which is what has to stay correct if the edge ever stops normalising.

**A guard-shape correction.** The first port asserted that a literal `../`
traversal never reaches the store. It does — `new URL()` *resolves* dot segments,
including `%2e%2e`, so `/chassis/../mule.webp` arrives as `/mule.webp`. Nothing
escapes, because R2 keys are flat and the result is an ordinary in-bucket lookup;
the shape that genuinely needs the guard is an **encoded slash**, which URL
parsing cannot collapse. The existing Netlify suite already had this right and
said so in a comment — the port briefly got it wrong.

The routing table must be ported **in order**. Order is load-bearing at four
points, each with an incident behind it:

1. Retired-URL 301 — `/sheet/:kind/:id/share` → the sheet (#797).
2. The four method-conditioned `/api/snapshots` rules, which become `req.method`
   switching inside the Worker.
3. `/assets/*` → **404**, never 200.
4. SPA fallback.

> `not_found_handling: "single-page-application"` answers **200** for a missing
> hashed chunk, silently reintroducing the #759 cache-poisoning bug. `/assets/*`
> must be handled Worker-first, and the curl assertion below is the only thing
> that proves it.

**Gate — met 2026-08-18, with one item reframed on evidence**

| Surface     | URL                             | Evidence                                   |
| ----------- | ------------------------------- | ------------------------------------------ |
| `su-assets` | `su-assets.alxjrvs.workers.dev` | 57/57 objects byte-identical (SHA-256)     |
| `srd`       | `su-srd.alxjrvs.workers.dev`    | 8/8 Playwright against the deploy          |
| `itun`      | `su-itun.alxjrvs.workers.dev`   | full snapshot lifecycle on real R2         |

- [x] `bun --filter srd gate` clean. It **failed first**, correctly, when
      `_redirects` appeared and `_headers` grew; the re-blessed diff is two lines
      and `html: 1039` is unchanged.
- [x] curl against the live deploys: a real hashed chunk 200 `text/javascript`;
      a rotated-away one **404, not the SPA shell**; `/`, `/s/<id>`,
      `/p/pilot/<id>` 200 HTML; missing srd page 404.
- [x] All three header sets verified **on live responses**, including
      `su-assets`' (#778) and the CSP carrying Sentry's **EU** ingest origin.
- [x] Redirect order verified live: retired-share 301, the four
      method-conditioned `/api/snapshots` rules, `/assets/*` 404, SPA fallback.
- [x] **srd**: 8/8 Playwright against the deployment.
- [~] **itun**: see below. Reframed, not waived.

**The itun suite is at exact parity with local, and that is the finding.** Run
back to back on the same commit:

| Target                             | Result                |
| ---------------------------------- | --------------------- |
| Local build (`CI=1`)               | 7 failed, 33 passed   |
| Cloudflare deploy (`E2E_BASE_URL`) | 7 failed, **34** passed |

The failing sets are **identical**, matched by artifact path — seven specs that
all build an entity through a wizard and then assert on the live sheet or
roster. They are pre-existing on `main` (`e2e-nightly` has been red since at
least 2026-08-16, tracked in #756) and unrelated to this migration. Filed with
the full comparison as #851.

"Both suites green" was therefore the wrong bar to hold this against: the suite
is not green anywhere, and waiting for it would block the migration on an
unrelated regression. **Identical failure sets is the stronger assertion** — a
migration that changed behaviour would have produced a *different* set. The
deployed run passing one more is a flaky test, not a difference.

### The lesson this phase kept teaching: esbuild follows modules, not calls

Two builds failed on the same misunderstanding, in different disguises:

1. Splitting the snapshot handlers' *reporting* was not enough. Importing a
   factory out of `netlify/functions/` dragged that module's `@sentry/node`
   import into the Worker bundle. The handlers moved to
   `src/lib/snapshot/handlers.ts`; each platform file is now a thin adapter.
2. `createNetlifyBlobsStorage`'s `@netlify/blobs` import was already written as
   `await import(...)` — enough for Bun at runtime, **not** enough for a
   bundler. Moved to `storageNetlify.ts`.

The tempting fix for both was `nodejs_compat`. It would have been wrong twice:
it grows the bundle with a shim nothing needs, and it makes the *next*
accidental Node-only import invisible.

### Rate limiting, kept honest

P3 recorded "do not port the in-process limiter". Moving the handlers verbatim
would have silently contradicted that, so it became a parameter: Netlify keeps
its limiter (behaviour unchanged, still exercised by the existing tests) and the
Worker passes `rateLimiter: null`, because Cloudflare's binding is edge-enforced
and is a real control. One host, one mechanism.

### P5 — Bot on HTTP interactions · **DONE 2026-08-19** · reversible

The Interactions Endpoint URL is set to
`https://su-discord-bot.alxjrvs.workers.dev/` and Discord accepted it. Saving
that field **is** the cutover: from that moment Discord delivers interactions
over HTTP to the Worker and stops delivering them over the gateway, across all
3 servers at once.

**It depends on neither domain.** The bot runs on `workers.dev`, so this was
able to go ahead while `salvageunion.io` is still stuck behind a support ticket.

**Discord's own validation is the strongest gate here, and it passed.** Saving
the URL makes Discord send a correctly-signed PING expecting a PONG *and* a
deliberately malformed one expecting 401 — it refuses to save unless both hold.
Verified independently first, so a rejection would not have been a mystery:

```
POST, no signature      401
POST, bogus signature   401
GET  /                  405
GET  /health            200   {"ok":true,"discordStatus":200,"botUser":"SalvageUnion.io"}
```

The app's Public Key in the portal matches `wrangler.jsonc` byte for byte, which
is what makes the signature check able to succeed at all.

**No Game-command regression, because there is none to lose.** The Worker reports
`mode: solo`, and so was Render: `render.yaml` declares `ITUN_CONVEX_SITE_URL`
and `ITUN_BOT_SECRET` as `sync: false`, and neither was ever set — on Render or
in Convex. Reference commands (`/su roll`, `/su lookup`) behave
identically; Game commands said "not connected" before and still do.

**This one WAS reversible, unlike the DNS flip** — clearing the Interactions
Endpoint URL returned delivery to the gateway, so the instruction here was to
leave the Render service running as the fallback until a real command had been
exercised in Discord.

**That window is closed.** The command was exercised the same day (below), and
the Render account was deleted on 2026-09-01 along with the gateway code itself.
There is no fallback to return to and no longer anything to return to it: the
Worker is the only transport. Kept as written because the sequencing — prove the
new path with a real command BEFORE destroying the old one — is the part worth
repeating, and it was followed.

**Verified by a real command in a real server, 2026-08-19.** `/su roll` was run
in Discord and rendered correctly. The server side agrees, and the subrequest
line is the part that proves the *whole* path rather than just receipt:

| Metric (24 h window, 19 invocations) | Value                           |
| ------------------------------------ | ------------------------------- |
| Errors                               | **0**                           |
| CPU time                             | **951 µs** — vs a 10 ms ceiling |
| Wall time                            | 80 ms                           |
| Subrequests → `discord.com`          | 13, **all 2xx**, 97.9 ms        |

Those 2xx subrequests are the Worker calling Discord's API to post its reply and
Discord accepting it — so signature verification, dispatch, the roll itself and
the follow-up all held. (Some of the 13 are this document's own `/health`
probes, which call `/users/@me`; zero errors across all 19 covers both.)

**P2's prediction held with an order of magnitude to spare.** It measured 141 ms
startup and argued the per-request budget was not a risk; a real interaction
costs under 10% of the free-tier CPU limit.

The same page showed CI redeploying the bot unprompted ("deployed 6 seconds
ago"), which is the `deploy-cloudflare.yml` step added for exactly this reason —
the bot now tracks `main` instead of waiting for someone to remember `wrangler
deploy`.

~~Still unverified by a human:~~ an actual slash command in a real server. Discord
proved the transport; only a person can prove a command renders.

### P5 — original plan · reversible until flip · 3 days

Write one adapter satisfying the three types in `commands/interactions.ts` over
`@discordjs/builders` + `@discordjs/rest`. The gateway half of `discord.js` does
not run on workerd; the rest is portable. `index.ts` and `events/ready.ts` are
the only genuinely gateway-bound modules.

Port items:

- `interaction.client.user?.displayAvatarURL()` (`buttons.ts`, `itunReply.ts`)
  reads the bot's own user from the gateway cache. Hardcode or fetch once.
- `EmbedBuilder` instances passed as `embeds: [embed]` need `.toJSON()`.
- Every deferred command (`game.ts`, `itunReply.ts`) needs `ctx.waitUntil()`.
- `getClientIp()`'s `x-nf-client-connection-ip` becomes `CF-Connecting-IP`.
- Everything in P2's constraint list.

> The cutover is **atomic across every server**. Gateway and HTTP interactions are
> mutually exclusive and the Interactions Endpoint URL is application-level, not
> per-guild. There is no canary, no percentage rollout and no test guild.

**Gate — partially met 2026-08-18**

- [x] A signed replay harness passes for every interaction shape — 15 tests.
      Ed25519 keypair generated locally; no second Discord application. Covers
      PING/PONG, five distinct rejection cases, slash commands, autocomplete and
      buttons.
- [x] Bundles for workerd at **590.10 KiB gzipped** (19.7% of the 3 MB Free
      ceiling) with the real command set — close to P2's 549.6 KiB projection.
- [ ] `cpuTime` from `wrangler tail` under 10 ms for every command shape.
      Requires a deployed Worker and therefore the secrets below.
- [ ] Server admins told the bot will display permanently offline.

**Corpus note.** The gate said "harvested from the live bot". The harness uses
*synthesised* payloads instead, because harvesting needs a production code change
to log raw interactions and a wait for real traffic — and the shapes are fully
specified by `discord-api-types`. What synthesis cannot cover is Discord's own
behaviour: whether it accepts our PONG when the endpoint URL is saved, and
whether a deferred reply lands inside 3 seconds under real latency. Both are
verified at the flip, and neither is discoverable from a corpus either.

**Three defects the harness found, none of which unit tests could have.**

1. **`config.ts` at module scope was fatal on Workers.** It calls
   `requireEnv('DISCORD_TOKEN')` at import, four ITUN command modules imported
   it, and all four are reachable from `su.ts` — so the isolate would throw at
   startup, before serving anything. `test/env.ts` is preloaded via
   `bunfig.toml`, so every behavioural test passed: **the preload is exactly what
   hid the bug.** Fixed with `itunSettings.ts`, the same transport-neutral
   pattern as `report.ts`, and guarded by `__tests__/workerEnv.test.ts`, which
   asserts the *structural* property — the Worker's transitive imports never
   reach `config.ts` — rather than a behaviour a preload can mask.
2. **The ITUN client resolved at module load**, which on Workers meant it
   captured settings before any entrypoint could install them and pinned the bot
   to Solo mode permanently. Now resolved lazily; `undefined` means "not yet
   resolved" and `null` means "resolved, and Solo" — conflating the two is what
   made Solo sticky.
3. **`getString(name, true)` returned `null`.** That overload is typed `string`,
   so a missing required option handed a handler a value its types promised could
   not exist, surfacing five frames away as
   `null is not an object (evaluating 'value.indexOf')`. It now throws, as
   discord.js does, and the dispatcher turns that into a clean error reply.

**Secrets to set before deploying.** One command, not five:

```
wrangler secret put DISCORD_TOKEN --name su-discord-bot
```

Optionally, for Connected mode — set **both** or neither, or the bot reports
itself unreachable rather than Solo:

```
wrangler secret put ITUN_BOT_SECRET      --name su-discord-bot
wrangler secret put ITUN_CONVEX_SITE_URL --name su-discord-bot
```

**`DISCORD_APPLICATION_ID` and `DISCORD_PUBLIC_KEY` are now committed `vars`,
not secrets**, and the earlier list treating them as secrets was wrong. Discord
publishes both to every app owner: the application id appears in every invite
URL, and the public key is the *verification* half of a keypair — it can check
that a request came from Discord and cannot produce one. Publishing it is what
public keys are for. Putting them behind a manual step bought nothing and
obscured which value genuinely needs protecting. Committed, a mismatch shows up
in a diff instead of as a silent 401 on every interaction.

**The Discord application is `SalvageUnion.io`** (id `1442878052823470172`),
under the `SU-SRD` team — not the similarly-named apps under `Randsum.io`.
Verified by its description, which lists this repo's exact `/su` surface.

**The flip's blast radius is 3 servers and ~20 users.** That makes the
"tell server admins about the permanent-offline display" gate item small and
concrete rather than an open-ended comms task. Its Interactions Endpoint URL is
confirmed **empty**, so the bot is still on the gateway.

### P6 — Data sync and write freeze · **irreversible** · ½ day

Two stores move, and writes landing on Netlify after the final sync are lost.

- Seed R2 artwork from the P1 export. Reconcile by count and per-key SHA-256.
- Copy the `snapshots` store to R2. Reconcile by count and payload hash.
- Ship a Netlify build where `POST` and `DELETE /api/snapshots` return 503, so
  writes stop at a known instant while reads keep working from both origins.
- Run a final delta sync.

**Gate**

- [ ] R2 artwork object count and every per-key hash match the manifest.
- [ ] Snapshot count matches and payload hashes match.
- [ ] `POST /api/snapshots` observed returning 503 in production.
- [ ] The final delta sync reconciles to **zero** objects, verified after the
      freeze rather than before.

### P7 — Cutover · **irreversible**

> **BOTH domains can now be flipped. As of 2026-08-28 this table's last column
> is history** — `salvageunion.io` was transferred out of Netlify into the
> operator's own Name.com account, which is what the deadlock section below
> exists to break. The section is kept because the *shape* of the trap is worth
> recognising again, not because it still binds.
>
> | Domain              | Registrar (registry record) | You manage it at                 | Flip possible?                    |
> | ------------------- | --------------------------- | -------------------------------- | --------------------------------- |
> | `intheunionnow.com` | Tucows Domains Inc.         | **Hover** — it is in the account | **Yes** — done 2026-08-19         |
> | `salvageunion.io`   | Name.com, Inc.              | **Name.com** — since 2026-08-28  | **Yes** — was "no, see deadlock"  |
>
> `salvageunion.io` was **registered through Netlify** on 2025-11-17. Netlify
> resells through Name.com, which is why the registry names a registrar nobody
> here has an account with. It auto-renews **2026-10-16 at $61.99/yr**.
>
> The renewal date is `domain.auto_renew_at` on the Netlify DNS zone, not a
> figure to restate from memory — this line said 2026-10-14 until it was read
> back from the API. Re-derive it with
> `netlify api getDnsZones --data '{}'`, which also carries `transferred_at`
> and `auth_code` — the two fields that actually say whether P7 has moved.
>
> That took four independent confirmations, because "who is the registrar" had a
> misleading answer and acting on it would have sent someone to create an account
> at a company they had never used:
>
> | Source                | Says                                                |
> | --------------------- | --------------------------------------------------- |
> | Registry `whois`      | Registrar: Name.com, Inc. (IANA 625)                |
> | Netlify API DNS zone  | `uses_netlify_registrar: true`                      |
> | Netlify dashboard     | "Registered through Netlify on Nov 17, 2025"        |
> | Purchase receipt      | Netlify invoice `TGKTGM-00001`, $46.99, same day    |
>
> The `whois` answer alone is the trap: it is technically correct and practically
> useless, because the account that controls the domain is the **Netlify** one.

#### The deadlock on `salvageunion.io` — BROKEN 2026-08-28

**Resolved by step 2's ticket; kept because the shape recurs.** Three facts that
individually looked fine and together did not compose:

1. Netlify's domain page for a **Netlify-registered** domain shows its
   nameservers **read-only**, with no field to change them. (Compare the page for
   `intheunionnow.com`, registered externally, which instead says *"go to your
   domain registrar and change your domain's name servers"* — Netlify expects
   you to have a registrar you can reach. For this domain, Netlify **is** it.)

   **This is a data-model fact, not a UI one** — worth knowing before anyone
   spends an afternoon hunting for a hidden setting or an undocumented endpoint.
   The registrar record returned by `netlify api getDnsZone` carries
   `account_id, auth_code, auto_renew, auto_renew_at, created_at, deleted,
   expires_at, failure_reason, id, name, registered_at, renewal_price, status,
   transferred_at, updated_at, user_id` — **no nameserver field of any kind.**
   The zone's `dns_servers` is a read-out of which NS1 pool Netlify assigned,
   not a delegation target. And `netlify api --list` exposes only zone CRUD plus
   `transferDnsZone`, which moves a zone **between Netlify accounts** — its name
   invites the opposite reading, so do not reach for it. There is nothing to
   set, from any client.

2. Cloudflare Registrar will not accept a transfer until the domain is
   **Active** on Cloudflare — which means its nameservers already point at
   Cloudflare.

3. Nameservers can only be changed at the registrar.

So the domain cannot be pointed at Cloudflare while Netlify holds it, and
Cloudflare will not take it until it has been pointed at Cloudflare. Netlify →
Cloudflare directly is not a path.

#### Breaking it — Netlify's own documented exit

From the **Danger zone → Transfer domain** panel on the Netlify DNS page. The
support link there is pre-filled with the right subject and body.

1. ~~Create a **Name.com** account and verify the ICANN contact details.~~
   **Done 2026-08-19.** An account already existed; account code
   `776035-066df82`. Contact details verified by email code —
   *"Contact(s) successfully updated."*

   **The registrant Organization was "X" and has been cleared**, which is the
   part worth keeping. Name.com's own warning states the rule: *"ICANN policy
   links the 'Organization' field in your domain's contact details to its legal
   ownership. If this field contains information, the listed organization is
   considered the legal 'Registered Name Holder' (domain owner)."* Left alone,
   a placeholder from an old signup would have become the **legal owner** of
   `salvageunion.io` the moment it transferred in. Defaults apply on *"new
   registrations or registrar transfers"*, so this had to be fixed **before** the
   transfer, not after — correcting it afterwards is an ICANN Change of
   Registrant, which can impose a **60-day transfer lock** and would have blocked
   the move to Cloudflare.

2. ~~Open a **Netlify support ticket** with the Name.com Account Code.~~
   **Submitted 2026-08-19 — ticket `#1093312`.** Netlify's support form has a
   dedicated *"Transfer a domain away from Netlify"* topic that asks for exactly
   these three fields and validates the domain (*"This domain is served by
   Netlify"*).

   Their auto-triage reply framed it as *"we'll need to help you get the
   authorization code"*, which is the **wrong shape** for this case and was
   corrected in the reply: an auth code alone is useless here, because Cloudflare
   will not accept a transfer until the zone is Active, and the zone cannot go
   Active without a nameserver change that only a registrar account can make.
   What is needed is the domain **in the Name.com account**.

   This is the long pole — a human ticket, not an API call.

   **GRANTED, 2026-08-28.** Netlify Support (Mary Pangan) replied on the ticket:

   > "The transfer of the domain to your account at Name.com is complete and you
   > will see the domain settings there now. **No DNS changes have happened
   > yet.** However, you now can change the name servers at Name and all domain
   > renewals will happen directly at Name. It is also now possible to transfer
   > the domain from Name to some other registrar if you prefer another company."

   Name.com sent two confirmations in the same minute: an account transfer of
   `salvageunion.io` from `bitballoon` (Netlify's legacy entity) to the operator's
   account, and the registrant-contact update.

   **The deadlock this section describes is gone.** Netlify no longer holds the
   domain, so "the nameservers are read-only because Netlify is the registrar"
   no longer applies. The pessimism above — nine paragraphs on how Netlify does
   not document this service and two forum threads with no staff reply — is kept
   as written because it was honest when written and it correctly predicted
   nothing about the outcome. **It took nine days, and the answer was yes.**

   It also settles the either/or: Netlify moved the *registration* rather than
   setting the nameservers, so step 3 is ours to perform and needs no further
   correspondence.

3. ~~At Name.com, set the nameservers to `davina.ns.cloudflare.com` and
   `rajeev.ns.cloudflare.com`.~~ **DONE 2026-08-31.** The zone activated at
   **03:52:49Z** and `srd` + `assets` moved with it.

   #### How it actually went

   | Gate                        | Result                                              |
   | --------------------------- | --------------------------------------------------- |
   | Registry delegation         | only `davina` + `rajeev`; all four `nsone` gone      |
   | Zone activation             | `status: active`, `activated_on 03:52:49Z`          |
   | TLS + origin                | apex and `assets` both `server: cloudflare`         |
   | Content                     | `/`, `/about/`, deep `/schema/…` all 200            |
   | Missing page                | **404** — not the SPA shell, not a soft-200         |
   | `www` → apex                | **301**                                             |
   | Artwork                     | SHA-256 matches pre-flight (503,202 B)              |

   **Pressing "Check nameservers now" immediately is what made this cheap.** The
   API equivalent is `PUT /zones/{id}/activation_check`, which is what was
   actually used here — no dashboard needed, and it can be fired repeatedly while
   waiting. The itun flip's 3–4 minute outage did not repeat at anything like
   that length.

   **A stale public resolver will lie to you, and it looks exactly like a failed
   flip.** Minutes after activation, `dig A www.salvageunion.io @1.1.1.1` still
   returned the **Netlify** addresses (`98.84.224.111`, `18.208.88.157`) while
   Cloudflare's own nameservers already returned `104.21.92.92` /
   `172.67.190.224` — and an actual HTTPS request to `www` was being served by
   Cloudflare (`server: cloudflare`, `cf-ray` present) the whole time. Judge the
   flip by the **authoritative** nameservers and by `cf-ray` on a real response,
   never by a public resolver's cached A record.

   **Do not write a post-flip check that only asserts "an A record exists".** The
   first version of this gate did exactly that and printed `PASS` for the stale
   `www` answer above. A check that cannot distinguish the new origin from the
   old one is not a check — assert `server: cloudflare`/`cf-ray`, or compare
   against the authoritative nameservers.

   **Pre-flight, re-measured 2026-08-29 — all green.** The earlier readings were
   taken 2026-08-21, before the transfer, so they were re-run rather than
   trusted:

   | Check                                   | Result                                          |
   | --------------------------------------- | ----------------------------------------------- |
   | `dig salvageunion.io DS`                | **empty** — DNSSEC off, cannot strand resolvers  |
   | `AAAA` for all three hostnames @ CF NS  | **`100::`** — apex, `www` and `assets` attached  |
   | Artwork through the Worker              | **byte-identical** to Netlify (SHA-256 `9f3a06c7…`, 503,202 B, `/chassis/mule.webp`) |
   | `srd` routes, Worker vs Netlify         | **10/10 identical** — incl. `/about/`, two deep `/schema/…` pages, a 404 and the `sitemap.xml` 301 |

   The artwork check is the one worth keeping: `ASSET_BASE_URL` is compile-time,
   so every entity image in **both** apps moves the instant this hostname does.
   Comparing one rendered page would have covered whichever images that page
   happened to use; hashing the bytes through the deployed Worker covers the
   object itself.

   **This step needs a human at a keyboard.** It is a registrar UI action:
   Name.com has no session an agent can borrow, `op` needs interactive approval,
   and entering credentials is off-limits. There is a Name.com API
   (`POST /v4/domains/{domain}:setNameservers`) if a token is ever provisioned —
   nothing in this repo has one today, and this is the only step in the whole
   cutover that an agent cannot perform.
4. **Wanted, and now possible.** Unlock at Name.com, take the auth code, and
   transfer the registration to Cloudflare Registrar. `.io` is supported;
   transfers are at-cost, add a year to the expiry, and take up to 10 days.
   Netlify's reply explicitly clears it: *"it is also now possible to transfer
   the domain from Name to some other registrar."* This is consolidation, not
   cutover — step 3 already finished the migration.

   **Order matters, and it is the opposite of the intuitive one.** Do step 3
   first. Cloudflare Registrar will not accept a domain whose zone is not
   already Active, which is exactly the deadlock that cost nine days — so
   flipping the nameservers is the *prerequisite* for the transfer, not a
   consolation prize if the transfer stalls.

   **A renewal note that is no longer a deadline.** Renewals now happen at
   Name.com, not Netlify — Netlify's reply says so directly — so the 2026-10-16
   date this document used to treat as a forcing function is now an ordinary
   registrar renewal. It is still worth completing the transfer before it, to
   avoid paying a year at one registrar and then moving; but a missed date costs
   money, not the domain.

**Step 3 is the milestone. Step 4 is tidying.** Do not let the 10-day transfer
window read as 10 days of blocked cutover.

#### `intheunionnow.com` can go independently, and nothing couples them

Flipping itun while `salvageunion.io` is still on Netlify is safe. The one
apparent coupling is `ASSET_BASE_URL`, which is compile-time and points every
artwork URL in both apps at `assets.salvageunion.io` — but that hostname keeps
resolving to Netlify and keeps serving, so an itun on Cloudflare simply loads
artwork from the old origin until the second domain follows. Netlify stays up
until P8 regardless.

The cost of going first is only that itun — the domain **with live user data and
a write freeze** — becomes the rehearsal, instead of the read-only one. That is
a real trade and the reason the original order put `salvageunion.io` first.

#### The itun flip — DONE, 2026-08-19

`intheunionnow.com` is live on Cloudflare. Every gate passed in order:

| Gate                         | Result                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| Freeze took                  | `HEAD /api/snapshots` → **503** (405 would have halted it)     |
| Reads unaffected by freeze   | `GET /api/snapshots/:id` → 200                                 |
| Delta sync                   | **reconciled to zero** — 45 present, 0 copied, 0 failed        |
| Zone activation              | ~45 s after "Check nameservers now"                            |
| Universal SSL                | issued ~45 s after activation                                  |
| Post-flip smoke              | apex 200 · rotated-chunk 404 · snapshot read 200 · missing 404 |
| `www` → apex                 | **301** — the Redirect Rule fires, first time it could be tested |
| Publish → read → revoke      | 201 → 200 → 204 → 404, all against R2                          |

**There was a real outage of roughly 3–4 minutes**, and the runbook did not
predict it. Two sequential waits, neither avoidable:

1. **Zone activation.** Between the nameserver change and Cloudflare marking the
   zone Active, public resolvers returned the proxied placeholder `100::` —
   RFC 6666 discard space, not routable. The site was unreachable, not slow.
2. **Certificate issuance.** Once Active, TLS failed with a handshake alert
   until Universal SSL issued.

**Reverting during that window would have made it permanent**, which is the part
worth internalising: the zone can only activate *while* the nameservers point at
Cloudflare, so backing out guarantees it never activates. Once the flip is made,
forward is the only direction — hold and watch, do not panic-revert.

Both waits collapse if the dashboard's **"Check nameservers now"** is pressed
immediately after the flip rather than waiting for the periodic check (whose UI
copy says "1–2 hours… may take up to 24 hours").

**A pre-existing bug turned up and the migration fixes it.** On Netlify,
`DELETE /api/snapshots/:id` answers **405** — the method-conditioned redirect in
`netlify.toml` never matched, so share revocation has been broken in production.
Proven not to be a freeze artefact: the function itself answered 503 when called
directly at `/.netlify/functions/snapshot-delete/:id`, so it was deployed and
frozen; the redirect simply never routed to it. The Worker returns **204**,
because P4's routing table puts DELETE ahead of GET.

#### The itun flip, as it was run

**The snapshot write freeze is deliberately still OFF.** It protects only the
itun flip, and freezing it while the flip is not imminent would pause sharing for
real users in exchange for nothing. Turn it on immediately *before* the flip:

```sh
netlify env:set SNAPSHOT_WRITES_FROZEN 1 --site 801d6f8d-1ad4-42c1-a29d-126b2d69ee69
# redeploy so the Functions pick it up, then CONFIRM it took:
curl -o /dev/null -w '%{http_code}\n' -X HEAD https://intheunionnow.com/api/snapshots
#   503 = frozen (proceed)      405 = NOT frozen (stop; the flag did not take)
NETLIFY_SITE_ID=801d6f8d-1ad4-42c1-a29d-126b2d69ee69 bun tools/sync-snapshots-to-r2.ts
#   must report "reconciled to zero" — anything else means a write landed after the freeze
```

Then change the nameservers at **Hover** to the two Cloudflare ones.

**Leave the freeze on until decommission** — this corrects the "+1 h lift the
freeze" row below. Lifting it would let a stale resolver still pointing at
Netlify write a snapshot into Blobs that R2 never receives, which is the exact
loss the freeze exists to prevent. Nothing reaches Netlify once propagation
finishes, so there is nothing to gain by unfreezing and one way to lose.

**Historical — this flip is done.** At the time of writing both zones were
staged and answering on their assigned nameservers while the live delegation
still pointed at Netlify, so everything below had been rehearsed against the
real Cloudflare zones at zero customer risk. The "Live NS today" column below
records what was live *then*, not now.

| Zone                | Cloudflare NS                                            | Live NS today             | Flip it at |
| ------------------- | -------------------------------------------------------- | ------------------------- | ---------- |
| `salvageunion.io`   | `davina.ns.cloudflare.com` / `rajeev.ns.cloudflare.com`   | `dns{1..4}.p08.nsone.net` | Name.com   |
| `intheunionnow.com` | `davina.ns.cloudflare.com` / `rajeev.ns.cloudflare.com`   | `dns{1..4}.p02.nsone.net` | Tucows     |

Both zones drew the **same** nameserver pair, so the two flips are the same edit
made in two different control panels.

**Verify a staged zone with `AAAA`, not `A` — checking `A` makes a correctly
staged zone look empty.** A pending Cloudflare zone answers the proxied
placeholder `100::` on **AAAA only**; the same name queried for `A` comes back
`NOERROR` with `ANSWER: 0`. Both are authoritative (`aa` set), so nothing in the
response says "not configured yet" — it reads exactly like a zone with no
records, and the obvious conclusion is that the custom domains were never
attached or have been lost. Measured 2026-08-21, all three `salvageunion.io`
hostnames:

| Query                         | Against assigned NS    | Reads as                    |
| ----------------------------- | ---------------------- | --------------------------- |
| `salvageunion.io AAAA`        | `100::`                | staged, correctly           |
| `salvageunion.io A`           | `NOERROR`, `ANSWER: 0` | **nothing here** — it lies  |
| `www.salvageunion.io AAAA`    | `100::`                | staged, correctly           |
| `assets.salvageunion.io AAAA` | `100::`                | staged, correctly           |

The control that settles it either way is `intheunionnow.com`, which is **live**
on the same two nameservers and answers `A` with real proxied addresses
(`104.21.43.173`, `172.67.182.140`). If a staged name answers `100::` on AAAA it
is attached; compare against the live zone only to see what *activated* looks
like, never to judge whether staging succeeded.

The deploy output is the second, independent confirmation — every
`Deploy (Cloudflare)` run prints `salvageunion.io (custom domain)`,
`www.salvageunion.io (custom domain)` and `assets.salvageunion.io (custom
domain)` under "Deployed … triggers". Both signals agree: **the three hostnames
are attached and the zone is correctly staged.** Nothing about the flip needs
re-doing; it needs the nameservers and nothing else.

**DNSSEC is off, and that is one hazard fewer.** `salvageunion.io` publishes no
`DS` at the `.io` registry and no `DNSKEY` at its current nameservers (measured
2026-08-21), so the flip cannot strand resolvers on a signed chain that the new
nameservers cannot satisfy. Worth stating because it is the failure mode that
would be *invisible* until the flip and unfixable inside the outage window — and
because the one comparable request found on Netlify's forum had to ask for
DNSSEC to be disabled as a separate step. `intheunionnow.com` was likewise
unsigned and flipped cleanly. **Re-check before the flip rather than trusting
this line**, since either party could enable it in the meantime:
`dig salvageunion.io DS` must stay empty.

**The current nameservers are Netlify's own** (`nsone.net` is NS1, which Netlify
DNS runs on). Netlify is therefore not just the origin here, it is the DNS
provider — which fixes the order of P7 and P8 rather than leaving it to
preference: **the flip must precede decommissioning**, because deleting the
Netlify sites while they still answer for the domain would take DNS down along
with the origin.

#### The record set, measured — not scanned

Enumerated from Netlify's own API (`getDnsZones`), which is authoritative
because Netlify DNS *is* the current provider. **Five hostnames, and nothing
else** — no MX, TXT, CAA, DMARC, or other subdomain in either zone:

| Hostname                 | Type      | Target                         |
| ------------------------ | --------- | ------------------------------ |
| `salvageunion.io`        | `NETLIFY` | `suindex.netlify.app`          |
| `www.salvageunion.io`    | `NETLIFY` | `suindex.netlify.app`          |
| `assets.salvageunion.io` | `NETLIFY` | `su-assets.netlify.app`        |
| `intheunionnow.com`      | `NETLIFY` | `in-the-union-now.netlify.app` |
| `www.intheunionnow.com`  | `NETLIFY` | `in-the-union-now.netlify.app` |

**There are no A records to transcribe, and this corrects two steps that were
previously in this runbook.** Every record is Netlify's `NETLIFY` ALIAS type,
resolved to a load-balancer address *at query time*. The A records Cloudflare's
onboarding scan captured are therefore a snapshot of a synthesized answer, not
configuration — demonstrated twice while staging the zones:

- the `salvageunion.io` scan returned `13.52.188.95` / `52.52.192.191` (us-west)
  while production resolved `98.84.224.111` / `18.208.88.157` (us-east);
- the `intheunionnow.com` scan returned **us-east for the apex and us-west for
  `www`** — two hostnames with identical configuration, different answers, one
  scan.

Copying either pair would pin production to one region for no benefit.

**The scanned records must be DELETED, not left as placeholders — and this
corrects an earlier instruction here that said the opposite.** Leaving them
looked harmless, since a non-authoritative zone serves nothing. It is not: a
Worker custom domain creates its own DNS record, and Cloudflare will not write
one over an existing record for the same name. The first deploy carrying a
route failed with

```
PUT .../workers/scripts/su-assets/domains/records
-- CF API RESPONSE: Conflict 409
```

which wrangler surfaces only as *"A request to the Cloudflare API … failed"*.
Deleting the six records and redeploying attached the domain immediately, so the
409 was the conflicting placeholder and **not** the zone being pending — a
pending zone accepts custom domains perfectly well. Both zones now hold zero
records; wrangler writes the real ones.

#### The certificate window is the one unavoidable exposure

Cloudflare has **already ordered** the Universal SSL certificates for both
pending zones — for `salvageunion.io` they cover the apex, `www` and `assets`
— and every one of them sits at **Pending Validation (TXT)**.

That status is the good case, and it decides the shape of the flip. TXT
validation is something Cloudflare performs against the zone *it is authoritative
for*, so it cannot complete while the nameservers still point at Netlify, and it
completes on its own within minutes of the flip. Nothing needs to be done to
make it happen and nothing can make it happen sooner: DCV delegation and
pre-validation are Advanced Certificate Manager features, and these zones are on
Free.

So there is a short window after each flip where a resolver that has already
picked up Cloudflare gets a TLS error rather than a page. It is minutes, it is
unavoidable on this plan, and it is the reason the flips are sequenced apart
rather than done together — `salvageunion.io` first, verified, then
`intheunionnow.com`.

#### Propagation is ~1 hour, not 24–48

The binding constraint is the **NS delegation TTL at the parent registry**,
measured at **3600 s** via `dig +trace` — not the zone's own record TTLs. That
is why the old "−48 h: reduce TTLs to 300 s" step is gone: lowering a record TTL
inside the zone does not touch the delegation, and the synthesized A answers
already carry a 120 s TTL, which is *below* the 300 s that step aimed for. It
would have bought nothing and cost two days.

#### `routes` silently disables `workers.dev` — the gate's own blind spot

Declaring `routes` makes wrangler turn off the workers.dev subdomain unless
`"workers_dev": true` is set explicitly. Measured on `su-assets`: the first
deploy carrying a route reported **"No targets deployed"**, and
`su-assets.alxjrvs.workers.dev` began answering Cloudflare's own 404 instead of
the Worker.

That would have been quiet and expensive. Every one of the five post-deploy
smoke tests in `deploy-cloudflare.yml` curls a workers.dev URL, and before the
flip there is **no other way to reach these Workers at all** — so the change
that removes the verification surface is the same change that needs verifying.
All three web configs now set `workers_dev: true`.

#### `www` must redirect, and `_redirects` cannot do it

Both `www` hostnames **301 to their apex today** — Netlify's primary-domain
behaviour, measured, not assumed:

```
https://www.salvageunion.io/    301 -> https://salvageunion.io/
https://www.intheunionnow.com/  301 -> https://intheunionnow.com/
```

Workers Static Assets does not do this for you. Attaching `www` and stopping
there would serve a full duplicate of each site — worst on `srd`, whose entire
purpose is being indexed.

`_redirects` is not the fix, and this was checked rather than attempted:
Cloudflare's documentation lists **domain-level redirects as unsupported**, the
`source` field is a file path only, and *"malformed definitions are ignored"* —
so a `www` rule there would silently do nothing and look fine in review. (The
file itself does work on Workers Static Assets; the existing
`/sitemap.xml → /sitemap-index.xml` rule was verified live on the deployed
Worker. It is host matching specifically that is missing.)

The mechanism is a zone-level **Redirect Rule**, one per zone, created in the
dashboard. Redirect Rules execute in the Rules phase, *ahead of* Workers and
asset serving, so the rule wins and the Worker never sees a `www` request.

| Zone                | When incoming host equals | Then                                     |
| ------------------- | ------------------------- | ---------------------------------------- |
| `salvageunion.io`   | `www.salvageunion.io`     | 301 → `https://salvageunion.io` + path + query |
| `intheunionnow.com` | `www.intheunionnow.com`   | 301 → `https://intheunionnow.com` + path + query |

`www` is still attached as a Worker custom domain in both `wrangler.jsonc`
files, for two reasons: a hostname must be proxied through Cloudflare before a
Redirect Rule can act on it at all, and it makes the failure mode safe — if a
rule is ever missing or deleted, `www` serves the site with its correct per-page
canonical tags rather than erroring.

**This is the only piece of cutover configuration that does not live in the
repo**, which is why it is written down here.

**Both rules are created and active** (2026-08-19), built from Cloudflare's own
"Redirect from WWW to root" template. Two things about that template are worth
knowing, because both are easy to get wrong and neither announces itself:

- **"Preserve query string" is UNCHECKED by default.** Netlify's redirect
  preserves it today, and srd has `/search?q=…`, so leaving the box alone would
  have silently dropped every query string on a `www` URL. The path is preserved
  regardless, by the `https://www.*` → `https://${1}` wildcard; the query string
  is a separate switch.
- **On deploy it warns that `www` is not a proxied record and offers to create
  one. Do not accept.** That is exactly the record that returns 409 Conflict to
  wrangler's custom-domain attach (see above). Choose *"Ignore and deploy rule
  anyway"* — wrangler creates the proxied record itself when the Worker deploys,
  and the rule starts matching the moment it exists.

The rules are live now but cannot fire yet, because no `www` record exists and
the zones are not authoritative. That is the intended order: the rule waits for
the hostname rather than the hostname waiting for the rule.

#### Pre-flight for the remaining flip — both surfaces compared against live

Done 2026-08-19, while `salvageunion.io` was blocked on the registrar transfer.
Neither check needed the domain, and both are the sort of thing that is much
cheaper to learn now than during a flip.

**`assets` — every object, byte for byte.** The migration verified that 57/57
objects were *copied* into R2; that is not the same claim as the Worker
*serving* them. Fetching all 57 from the live Netlify site and from the Worker
and comparing SHA-256:

```
identical: 57   differ: 0   missing: 0   of 57
```

**`srd` — a route sample, compared on shape rather than bytes.** Byte-equality
would be the wrong test: the two builds are different commits with different
`PUBLIC_COMMIT_REF` values, so identical HTML would be a coincidence, not a
pass. Status code and `<title>` matched on every sampled route, including the
404 path and `llms.txt`.

**One real difference, and it is being accepted deliberately: trailing-slash
redirects are `301` on Netlify and `307` on the Worker.** Both send `/about` →
`/about/` and both end at 200, so nothing breaks — but 301 is *permanent* and
307 is *temporary*, and for a site whose entire purpose is being indexed that
distinction is not cosmetic: a 301 consolidates ranking signals onto the
canonical URL, a 307 asks crawlers to keep the old one.

It is **not configurable**. `html_handling` decides *whether* to redirect
(`auto-trailing-slash`, `force-trailing-slash`, `drop-trailing-slash`, `none`);
the status code is the platform's.

Accepted rather than worked around, because the exposure is nearly nil and the
workaround is worse than the problem:

- the **sitemap** lists slashed URLs — the primary discovery path;
- every **canonical** tag declares the slashed URL, identically on both origins
  (and correctly names `salvageunion.io`, not the `workers.dev` host, because the
  production origin is baked at build time);
- every **internal link** on the site already uses the slashed form.

So the 307 fires only for an externally-typed or externally-linked unslashed
URL. The alternative — a zone Redirect Rule emitting 301 — would duplicate the
Worker's own trailing-slash logic and has to be written carefully enough not to
loop or to catch files with extensions. **Do not add one to chase a status
code.** If it ever matters, measure it in Search Console first.

#### Runbook

| When  | Step                                                                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| −1 h  | Execute P6 (write freeze, then the delta sync that must reconcile to **zero**).                                                                                                |
| −30 m | ~~Attach Worker custom domains for all five hostnames.~~ **Done 2026-08-19** — all five attached by the deploy workflow and each answering `100::` against the assigned NS. |
| −20 m | ~~Create the two `www` → apex Redirect Rules.~~ **Done 2026-08-19** — both active. They cannot be verified before the flip (no certificate is issued while a zone is pending), so verifying them is a **post-flip** step, never a pre-flip gate. |
| 0     | Flip nameservers on `salvageunion.io`. This moves `srd` and `assets.salvageunion.io` **together**, because `ASSET_BASE_URL` is compile-time.                                    |
| +15 m | Verify from multiple resolvers. Re-run the P4 curl assertions against real hostnames, including the rotated-chunk 404. **Confirm `www.salvageunion.io` 301s to the apex** — if it serves a 200, the Redirect Rule did not take. |
| +30 m | Flip nameservers on `intheunionnow.com`. Re-run the itun Playwright suite against production.                                                                                   |
| +1 h  | ~~Lift the snapshot write freeze.~~ **Do not** — leave it on until decommission. Unfreezing lets a stale resolver still pointing at Netlify write a snapshot into Blobs that R2 never receives, which is the loss the freeze exists to prevent. Once propagation finishes nothing reaches Netlify anyway, so there is nothing to gain and one way to lose. |
| +2 h  | Set the Discord Interactions Endpoint URL. Verify PING/PONG, then one command of each shape in a real server.                                                                   |

**Leave the Netlify sites serving until propagation completes.** DNS propagation
is not a rollback window, it is a physics window: both origins answer for the
length of the TTL, and deleting the old one at the moment of the flip is
strictly worse than leaving it — resolvers still holding the old delegation get
errors rather than a stale-but-working site. Decommissioning is P8, 24 h later.

There is **no grey-cloud → orange-cloud step.** A Worker custom domain is
proxied by definition; the record Cloudflare writes for it is already orange,
and the DNS-only placeholders it replaces are never in the serving path.

**Gate**

- [ ] Every gate P0–P6 green, recorded and dated in the Progress table.
- [ ] All five Worker custom domains attached and each verified against the
      assigned nameservers *before* either flip.
- [ ] All open decisions below are closed.

### P8 — Decommission and tooling cleanup · **irreversible**

Only after P7 has been stable for 24 h.

> **CLEARED 2026-08-28 — the Netlify team is no longer the registrar of record.**
>
> This block used to read *"DO NOT DELETE THE NETLIFY TEAM"*, and it was the
> sharpest hazard in the cutover: Netlify did not merely host `salvageunion.io`,
> it **sold** it and held it, so closing the account would have put the domain
> itself at risk rather than just its DNS. The registration has now been
> transferred out per P7 step 2 and sits in the operator's Name.com account.
>
> **Verify before acting on this paragraph, rather than trusting it** — the whole
> reason the hazard existed is that `whois` gave a technically-correct answer
> (`Name.com, Inc.`) that was practically useless, because the account that
> controlled the domain was the Netlify one. The check that actually settles it
> is logging into Name.com and seeing the domain, plus Netlify's own domain page
> no longer listing it. Do that once before deleting anything.
>
> Deleting the three *sites* was always fine and is what this phase means.
> Deleting the **team/account** is now unblocked in principle; it still waits on
> P7 being complete and stable.
>
> The renewal is no longer a Netlify charge at all: renewals happen at Name.com
> now (**2026-10-16, $61.99**). Still a cost worth beating with the registrar
> transfer, but no longer a reason to rush it.

> **BLOCKED on two snapshots, measured 2026-08-31.** Deleting the `in-the-union-now`
> site destroys its `snapshots` Blobs store, and two objects in it do not resolve
> against production:
>
> ```
> 45 keys in Netlify Blobs
> 43 return 200 from https://intheunionnow.com/api/snapshots/<id>
>  2 return 404 — RA0WMH9Q (pilot), XAM6VH8K (mech)
> ```
>
> Those two are a matched pilot-and-mech pair, so they were almost certainly
> shared together by one person. There are two readings and they have opposite
> consequences:
>
> - **Revoked.** They were synced, then their owner deleted the share. A 404 is
>   then CORRECT and the Netlify copy is stale. Restoring them would un-revoke
>   somebody's sheet.
> - **Never synced.** They were published to the Netlify functions after the
>   bulk copy — P6's write freeze was merged but never activated, and the final
>   delta sync never ran — so deleting the store destroys two live capabilities.
>
> The count is the argument for the first reading: Netlify holds exactly 45, and
> the bulk sync copied exactly 45 "compared by content", so nothing appears to
> have been published after it. That rests on trusting a recorded claim, which
> is not the standard this file holds itself to elsewhere.
>
> **Settled cheaply instead of argued:** all 45 are exported to
> `~/Documents/SU-snapshots-backup` (180 KB, one JSON per id). Deleting the site
> is now safe under EITHER reading — the never-synced case is recoverable with
> `tools/upload-lp-assets.ts`'s sibling path, and the revoked case needs nothing.
>
> Read the two files before restoring anything. A revoked share that comes back
> is a worse outcome than a dead link.

- ~~Delete the Render service.~~ **Done 2026-09-01 — the whole account is gone.**
- Delete the three Netlify sites and that account. **Still outstanding.**
- `.mcp.json`: remove `netlify` and `render`; add
  `https://bindings.mcp.cloudflare.com/mcp` and
  `https://observability.mcp.cloudflare.com/mcp`. Both authenticate by OAuth on
  first connect, so **`.mcp.json` stays secret-free** — #291 removed `${VAR}`
  placeholders deliberately; do not reintroduce them. Keep `convex`.
- Add one project skill, `/cloudflare-deploy-verify`, the sibling of
  `/convex-deploy-verify`. **One, not a suite** — the repository's bar is that a
  skill encodes a decision procedure or a silent failure mode, never frontmatter
  around a command, and six wrapper skills were deleted for failing that test.
  The four qualifying failure modes are P4's 200-vs-404 trap, P2's module-scope
  restriction, ADR-033 §3's KV consistency trap, and redirect ordering.
- Port or delete `tools/convert-lp-assets-to-webp.ts` and
  `tools/upload-lp-assets.ts`. **Not before P1's export is verified.**
- Remove `@netlify/blobs`, then delete both `--ignore` flags from `check:audit`
  and the CLAUDE.md section documenting them.
- Update CLAUDE.md, `docs/README.md` and
  [`agent-tooling.md`](agent-tooling.md) to describe Cloudflare.

**Gate**

- [ ] `bun run check` green with no `netlify.toml` anywhere in the tree. (`check:all`
      is a deprecated alias slated for removal — a gate that invokes a removed
      script fails for the wrong reason.)
- [ ] `claude mcp list` shows the Cloudflare servers connected — zero tool calls
      means "broken or unused" and the two are indistinguishable from usage data
      alone.
- [ ] `bun audit --audit-level=high` passes with **no** `--ignore` flags.
- [ ] No document still describes Netlify or Render as a host.

**30 days after P7:** audit skills by counted invocation — `"skill": "<name>:` in
the session transcripts — not by intuition; a skill's own prompt injection makes
it look ubiquitous. Anything at zero goes.

---

## Credentials

Today Netlify holds its own build credentials and this repository holds **no
deploy credentials at all**. Building in Actions means CI holds a token that can
deploy production, alongside an agent PAT with `workflow` scope, no required human
review, and pre-authorized `gh pr merge`.

Minimum bar before P4 ships to any real hostname:

- A Cloudflare API token scoped to *Workers Scripts: Edit* and, for R2,
  **narrowed to the named buckets** rather than account-wide. Cloudflare supports
  per-bucket R2 scoping and does not support per-Worker scoping, so the Workers
  half authorises editing any Worker on the account. With D5 closed in favour of
  the personal account (ADR-033 §6) that is the accepted residue — narrow the
  half that can be narrowed, and do not pretend the other half is contained.
- Stored as an Actions secret. Never in `wrangler.jsonc`, never in a `.env` git
  can see.
- Deploy steps gated on the `quality-checks` aggregate, so a red gate cannot
  deploy.
- D3 below decides whether production deploys additionally require an environment
  approval.

---

## Open decisions

| #   | Decision                                                                          | Blocks    | Default if unanswered          |
| --- | --------------------------------------------------------------------------------- | --------- | ------------------------------ |
| D1  | Netlify account plan type — credit-based plans fail hard rather than billing over | nothing   | closeable with an account read |
| D2  | Snapshot write freeze, or accept losing links published during propagation?       | P6        | freeze — it costs minutes      |
| D3  | Do production deploys require environment approval, or does a green gate suffice? | P4        | green gate suffices            |
| D4  | Announce the bot's permanent-offline display before the flip, or after?           | P5 gate   | before                         |
| ~~D5~~ | ~~Dedicated Cloudflare account~~                                                | —         | **Closed** — see below         |

**Closed by audit.** `lp-assets` has no backup and its ingest tool was deleted, so
P1 grows rather than shrinks. The snapshot rate limit is decorative. The bot is
independent of the web surfaces and P2 settled it on measured evidence.

**D5 — closed 2026-08-18: everything runs on `alxjrvs@gmail.com`.** A dedicated
account was considered and declined (ADR-033 §6). It would have been the only way
to isolate the Workers Free quota and to scope the CI token, since Cloudflare's
isolation boundary is the account and there is no in-account "team" — but nothing
else lives on the account, so the quota is shared with nothing today. The accepted
residue is credential blast radius: *Workers Scripts: Edit* on this account
authorises editing any Worker on it. **Narrow the R2 half to named buckets, which
Cloudflare does support.** Revisit if anything unrelated is added to the account.

---

## Accepted risks

- **No rollback**, chosen deliberately. Every gate is load-bearing.
- **The CI token can reach the whole `alxjrvs@gmail.com` account** (D5). Cloudflare
  scopes tokens by permission group and account, and supports per-bucket R2
  scoping but not per-Worker scoping. Nothing unrelated lives on the account
  today, which is what makes this acceptable; adding something would change that.
- **The bot displays permanently offline** in every server.
- **Netlify deploy previews disappear** when the sites do.
- **Sentry liveness telemetry changes shape** — `client.guilds.cache.size` does
  not exist under HTTP interactions.
- **This document will drift.** #830's premises drifted twice — once at
  authoring, once within a day of the audit. Re-verify against `main` before
  executing any phase.

---

## Follow-up: Convex → D1

Out of scope, with its own future ADR. Sized here only because the constraint it
places on this migration is binding today.

| Surface                                 | Size                              |
| --------------------------------------- | --------------------------------- |
| Application tables                      | 15                                |
| Auth tables from `@convex-dev/auth`     | 6 (approx.)                       |
| Function modules / total LOC            | 18 · 4,589                        |
| Client reactive call sites              | 27 `useQuery` · 27 `useMutation`  |
| Files importing `convex/react`          | 20                                |

Schema translation to SQLite is the easy part. Three things are not:

1. **Reactivity.** D1 has no subscriptions. ADR-030 identifies the reactive model
   as the actual product feature and 27 call sites consume it. Cloudflare's answer
   is Durable Objects with hibernating WebSockets, or polling — the first is a
   real design exercise, the second is a product downgrade.
2. **Auth.** Discord OAuth terminates on Convex via `@convex-dev/auth`. Replacing
   it means owning the OAuth flow, session issuance and refresh, plus the
   `authAccounts` lookup the Discord bot uses to resolve a snowflake to a user.
3. **Transactions.** Convex mutations are serializable by default; invariants the
   platform currently guarantees would have to become explicit.

**Binding on this migration** (ADR-033 §5): snapshots go to R2 and not into
Convex, and the Worker↔Convex boundary stays plain HTTP with a bearer token.

---

## Appendix — the P2 probe

Deliberately **not** committed as a tool. It is a throwaway that answered a
question, and keeping it as a permanent `tools/` entry would create maintenance
surface — typecheck, knip and lint would all want to own a file whose runtime is
workerd rather than Bun. Recorded here so it is reproducible instead.

`wrangler.jsonc`:

```jsonc
{
  "name": "su-p2-throwaway-probe",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-13"
}
```

`src/index.ts` — imports the reference corpus and the portable Discord
dependencies the command layer actually uses, preloads at module scope, and
returns a lookup:

```ts
import { EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder } from '@discordjs/builders'
import { Collection } from '@discordjs/collection'
import { REST } from '@discordjs/rest'
import { MessageFlags, InteractionResponseType, ButtonStyle } from 'discord-api-types/v10'
import { SalvageUnionReference } from '<abs path>/packages/salvageunion-reference/lib/index.ts'

const t0 = Date.now()
await SalvageUnionReference.preload('all')
const startupPreloadMs = Date.now() - t0

// REST must NOT be constructed at module scope — its constructor registers
// sweeper timers, which workerd forbids in global scope.
let rest: REST | null = null
const getRest = () => (rest ??= new REST({ version: '10' }))

export default {
  async fetch(): Promise<Response> {
    const chassis = SalvageUnionReference.Chassis.all()
    const embed = new EmbedBuilder().setTitle(chassis[0]?.name ?? 'none')
    return Response.json({ startupPreloadMs, chassisCount: chassis.length })
  },
}
```

Run:

```bash
bunx wrangler deploy --dry-run --outdir=dist   # bundle size, no account needed
bunx wrangler dev --port 8799                  # real workerd, locally
bunx wrangler deploy                           # prints "Worker Startup Time: N ms"
bunx wrangler delete --name su-p2-throwaway-probe --force
```

`wrangler deploy` is the authoritative startup measurement: Cloudflare enforces
the startup budget at deploy time and reports the figure on success. Do not
register a `workers.dev` subdomain to route a probe — that name is account-scoped
and effectively permanent, so it should be chosen deliberately in P4.
