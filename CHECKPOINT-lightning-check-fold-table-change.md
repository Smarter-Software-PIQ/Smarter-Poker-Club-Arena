# Lightning Check/Fold Carries And Table Change, 2026-11-09

Owner: cloud chat session_01BNteGXcb4Y2qYvDoMAsxch. Branch: fix/lightning-check-fold-table-change-20261109. Base: de2e79762d5ec60b9b37792ed4e9acda83b25cab.

Authorization: direct owner request 2026-11-09 13:53 Chicago, three items, Lightning games only: (1) smoother transition to the new table; (2) Check/Fold in the blinds fast-folds at once when priced, the public fold still waits for the turn, and an unpriced Check/Fold stays active every street until a bet or showdown; (3) further improvements to the same flow as needed. Full wording: docs/changelog/2026-11-09-lightning-check-fold-carries-and-table-change.md.

Scope: LightningHandHost pre-action handling; the Lightning room's pre-action arm, exit marker and seat arrivals in TablePage; seatArrival; LightningFoldBar.css. Exclusions: Classic tables, the shared PreActionEngine (still single-shot, Dan 2026-08-28), money paths, schema, matcher, new timers or watchers.

Acceptance: priced Check/Fold releases at arm; free Check/Fold releases on the bet before the turn; public fold only in turn order; chips conserved; carry across streets to showdown; fast-fold switch off keeps it turn-bound; no arm survives into another hand; Classic unchanged; every table has an exit; pot fades with the table; a new table arrives whole; client works against the serving engine; compilers, hooks, required CI, protected merge, client publication at both build-info endpoints, engine staged for the daily window, affected live behaviour.

Policy reader: emitted 2026-11-09T19:55:13.845Z, version 2.9, manifest 7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52; owner 73c17bed0bc531031283fa33c0b45d4546869166beef9d714bcfe76cfcdb9fdb, operating a8bc3c04dce3354ebdd51a89c0b7d715af3344edcc794d33f6b3ad64506961d5, hardening d5fc451ce5caf6d6b5e64597a13883e1246581678fe53c962339d0a66136993e, index adce89c3f838f2f373cd504a00329d53906404d1dd42a647f672af6c16f95555. Read: repository AGENTS.md, AGENT-PLAYBOOK.md, CLAUDE.md, reference index, CHECKPOINT-lightning-turn-fold-leave.md, docs/VERIFIED-DELIVERY-ROUTES-2026-11-09.md. NOT read: the canonical /Users/smarter.poker/Documents/AGENTS.md and AGENT-HARDENING-STANDARD.md (cloud checkout; the folder grant was declined). The portable mirrors were read instead.

Cause: (2) setPreAction queued auto_check_fold until the turn even when already priced, nothing released an armed Check/Fold when a bet priced it, and the shared engine spends every arm once. (1) only a fold marked the felt as leaving; the exit fade ran the whole hold and excluded the pot; arrivals skipped a known player in the same chair and rippled over 400 ms.

Delivery classification: client + engine, no database. The client releases a priced Check/Fold itself against the serving engine (fold_on_turn), so that part and the table change publish with the client. Carrying across streets needs the new engine (check_fold_carries) and activates only at the daily 04:00 Chicago window.

Validation in the cloud checkout on the working tree over de2e79762d: root `tsc --noEmit -p tsconfig.app.json` PASS; server `tsc --noEmit` PASS; eslint on changed files 0 errors; server `vitest run src/lightning src/handlers` 66 files, 893 tests PASS; root `vitest run tests/lightning tests/lightning-preflop-fold-waits-for-turn.law.test.ts` 84 files, 1489 tests PASS. Fail-before: 4 new engine cases and 18 new client cases fail on the previous source. Full root `vitest run tests/` in this container showed failures only in files that drive Git, shell release scripts or PostgreSQL, none touched by this change; that run is not a pass and the pre-push hook on the Mac is the applicable precheck.

Not done: no live table was watched; no PR, merge, publication or engine activation is claimed here. Next action: owned worktree on the Mac SSD, `npm ci`, apply this commit, `bash scripts/agent-push.sh`, PR, required checks, protected squash merge, both build-info endpoints, engine stage, live Lightning proof.

2026-11-09 20:55Z, owned Mac worktree /Volumes/SSD1-Mirror/agent-work/lightning-check-fold-01BNte over protected main ff3663610fe98fdac5d58a4076cd835bad76c144 (the patch from the cloud checkout applied byte-exact, sha256 ccfd777e6e8ff1146f06aca32133b22eaad4d6d2c7f70481d41198b5e4243fda, after a private `npm ci` in root and server): root `tsc --noEmit -p tsconfig.app.json` exit 0; root `vitest run tests/lightning tests/lightning-preflop-fold-waits-for-turn.law.test.ts` 84 files, 1489 tests passed; server `tsc --noEmit` exit 0; server `vitest run src/lightning src/handlers` 66 files, 893 tests passed. The pre-push hook, hosted checks, merge, publication and live proof are still to come.

2026-11-09 21:35Z: pushed 287f556a7e16b36bf187181ffb95accf7459f3b8 through scripts/agent-push.sh (normal pre-push passed, remote ref verified); PR 10231. Hosted CI run 42699593325 failed two jobs (129440452679, 129440673191) for one cause read from their logs: tests/unit/noFixedSizeSourceWindows.test.ts refused `PAGE.slice(start, start + 1600)` in the new tests/lightning/lightning-check-fold-carries.test.ts. Corrected to a window bounded by the handler's next statement; that guard and the corrected file pass locally (2 files, 22 tests). No production source changed by the correction.

## Continuation, 2026-11-09 22:00Z onward (same session, owner message 16:03 Chicago)

Scope added by the owner: finish the engine delivery through the existing ASAP cutover owner without a competing release; confirm the exact candidate contains #10231's engine changes; test reordered events, reconnects, background tabs and repeated taps; prove the arm belongs to its own hand; after seal and thaw verify both blind cases, cross-street persistence and the transitions on the supported test route; record revisions and results here; leave the migration-ledger failure with its owner; preserve shared checkout settings; clean up.

Resumption reading: policy reader emitted 2026-11-09T22:03:56.419Z on main 1f1863c40151e87e01495109a3ff35f17ef2619b, version 2.9, the four policy hashes unchanged from the receipt above. The lines added since base de2e79762d to AGENTS.md, CLAUDE.md (section 14, advisory code graph), PUBLISHING.md and docs/ENGINE-RELEASE-RUNBOOK.md were read as a diff; the unchanged remainder was read earlier in this session, not again. PR #10063 comments from 21:35Z and the coordination inbox entries from 18:00Z were read.

Delivered before this continuation: PR #10231 squash-merged 21:50:46Z as 616b10bac96993b1527467b80dee7e914b8c0fd3. Client published by publish-club-arena.yml run 42706349492; both build-info endpoints served ca_sha 616b10ba at 21:57Z. Serving engine then: bff6eed3522ee894da747f91a532b35a3d8cee4f (receiver 42683596427), which does not contain #10231.

Cutover custody: release owner GZo (session 01BNteGZoYBimiuwPFVM6CN9) holds sole custody of owner window 2026-11-09-owner-asap-engine-2230z (notice 22:10Z, admission 22:30Z to 04:30Z, predecessor bff6eed3). Stated candidate 4e7ba6d35fe451dfa2d8d8d09fa897ce779bfc50 (the head containing #10235). 616b10ba is an ancestor of it, and the four changed constructs were read out of server/src/lightning/LightningHandHost.ts at that tree. Posted as a read-only fact, PR #10063 comment 6752694392. This lane dispatches no Stage, Backup or receiver and merges nothing under server/**, supabase/migrations/** or release control until GZo posts SEALED and thaw.

Hardening found by reading, corrected in the client (no engine change needed):

1. The arm's hand key could outlive the bar on two paths (hand change, a refused arm). It was only ever compared to the live hand for keeping and releasing, but the exit hold tested it for non-null alone, so a later voided hand could have shown the hero folding. The hold now requires the arm of the hand that was just live and still the bar's choice (lightningEngineFoldedArm), and every path that clears the bar clears the arm.
2. A carried arm lives in the engine for the whole hand, so a page reloaded mid-hand came back unlit while the engine kept acting. The room now remembers which hand it armed (localStorage, per pool session, 15 minute expiry, this browser's record and never authority) and a reload of that same hand lights the toggle again without sending anything.

Engine hardening tests (server/src/lightning/LightningCheckFoldCarries.test.ts, 8 cases, all pass on the merged engine source, so no engine correction): repeated taps, a cleared arm, requests arriving after the release, stale-hand arms, a dropped and returning socket, several armed players priced by one raise, an all-in, and 40 seeded hands of random arms, clears, repeats, stale arms, fast folds and presence changes asserting one settlement, at most one fold and one release per player, no decision offered to a released player and every chip accounted for. That file lives under server/\*\* and is held unmerged until the release owner's seal.

## State at 2026-11-10 00:45Z (same session)

Client, delivered and published: PR #10238 squash-merged 22:57:23Z as d9187dfab93e304102f8170a17d07658224f8fc4 (the arm belongs to its own hand; a reload of the armed hand relights the toggle). Publisher run 42716404395; both build-info endpoints served d9187dfa at 23:04Z. At 00:44Z they serve 95a62df5a75597d77efb9d0f87024da31917c076, which contains it (compare: ahead, behind 0). The first push of that change was refused by the pre-push law tests/no-tdz-in-table-route.law.test.ts (a read of a later-declared ref); corrected at the source rather than baselined.

Engine, NOT delivered: at 00:43Z engine.smarter.poker/health still reports releaseSha bff6eed3522ee894da747f91a532b35a3d8cee4f, instance 1-cc09e13a, uptime 18464 s (receiver 42683596427, 19:28Z). No receiver has run since. The release owner (GZo, sole custody of window 2026-11-09-owner-asap-engine-2230z, admission until 04:30Z) pinned 89ad71df, then e603a0cd (Backup 42716683116), and at 00:33Z re-pinned to 923a821c9cef0429e82dde2f5c57d2fb962e8aaf (push Backup 42726872498, pending) after production installs staled each certificate (PR #10063 comments 6753766127 and 6755378011). Every one of those candidates carries #10231's engine change: 616b10ba is an ancestor, server/src/lightning/LightningHandHost.ts is untouched since it, and its three constructs were read from the tree at each SHA. This lane dispatched nothing.

Observed on production (read-only, hands formed 23:24Z to 23:47Z, published client against bff6eed3, two non-horse players):

- Small blind owing chips, released before the turn: four hands with fold_type fast where lightning_hand_player.folded_at precedes the public fold action by 0.7 s to 14.4 s (for example formed 23:37:07Z, released 23:37:13.376Z, public fold 23:37:27.817Z). Seat and public action stayed until the turn.
- Big blind priced by a raise: formed 23:36:19Z, raise 23:36:25.088Z, released 23:36:25.355Z (267 ms after the raise), public fold 23:36:26.405Z.
- The database cannot say which button was pressed, so these are consistent with the Check/Fold release and with the Fold button; they are not proof of the Check/Fold press itself.
- No duplicate seating or double fold in those rows: one lightning_hand_player row per player per hand.

Not verified, and why:

- Cross-street persistence and the engine's own release need an engine containing #10231. None is serving.
- No supported route presses Check/Fold as a player on production. The only funded Lightning route is the PLO lifecycle witness (run-plo-lightning-lifecycle-proof), which belongs to the PLO lane, never arms a pre-action and is mid-recovery. No new funded facility was built and no real chips were spent by this lane (CLAUDE.md 11.5).
- The table-change motion, and cards, pot and controls staying in step through it, have not been watched on a live table by this lane. They are covered by the client tests named above only.

Held, on branch test/lightning-check-fold-ownership-20261109: server/src/lightning/LightningCheckFoldCarries.test.ts (8 cases, pass with LightningHandHost.test.ts, 47 tests, on main cc652c44ca). It is under server/\*\*, so it must not merge until the release owner posts SEALED and thaw: a server-path push to main starts a push Backup that supersedes the pinned certification.

Left with their owners: the red, non-required "Installed and merged migrations agree" check (migration 20261109224452 applied outside the applier, issue #10246). Shared clone origin URL restored to its original SSH form after each use; this lane's two earlier worktrees removed.

Next action after SEALED and thaw: read /health for the sealed SHA and confirm it contains 616b10ba; merge the held test PR; for hands after the thaw read lightning_hand_player and hand_history actions for (a) a blind released within about 100 ms of the pricing raise with the public fold later, which only the engine release produces, and (b) one player's origin pre_action checks on consecutive streets of one hand; record both here. A person pressing Check/Fold once in the big blind on a Lightning table is the direct proof of the carry.

## Post-cutover evidence, 2026-11-10 14:45Z (same session)

Engine, delivered. The 0440z owner window ended NOT RELEASED (receiver 42766862282 failed at the restart-certificate step, production recovered to bff6eed3; release owner note, PR #10063 comment 6760823773). The daily 04:00 America/Chicago route then released: receiver 42794253316 (created 09:51:49Z), "Publish Through Hetzner Club Arena" success 10:10:43Z, append-only release receipt 10:11:20Z, spectator evidence bound to the sealed release 10:14:24Z. At 14:36Z engine.smarter.poker/health reports releaseSha 840429a332ecb536d19b3b719fa6809e7bc63ca7, instance 1-eaca1bce, phase idle, maintenance inactive, uptime 16061 s, liveness ok. This lane dispatched nothing.

That exact revision contains #10231: 616b10ba is an ancestor (compare: ahead 90, behind 0), and server/src/lightning/LightningHandHost.ts at 840429a3 is byte-identical to the file at 616b10ba (sha256 prefix 01072d1703684422b10f) with all four constructs present (check_fold_carries: true, releasePricedCheckFolds declared and called, the auto_check_fold re-arm).

Client at 14:36Z: both build-info endpoints serve 884b85df1e5dbdf1dec6d5aa5f486c9d22a05c73 (publisher run 42834627148), which contains d9187dfa (#10238) and therefore #10231.

Observed on production against 840429a3 (read-only; hands formed after 10:15Z; one non-horse player, 74 Lightning hands, 33 fast folds, 10 of them from a blind):

- Small blind owing chips, released before its turn, seat and public action unchanged until the turn: seven hands. Examples: formed 10:23:18Z, released 10:23:28.955Z, public fold 10:23:29.776Z; formed 10:26:38Z, released 10:26:42.717Z, a raise at 10:26:44.483Z, public fold 10:26:44.489Z; formed 10:30:06Z, released 10:30:10.704Z, raise 10:30:12.337Z, public fold 10:30:12.354Z.
- Big blind priced by a raise, released before the public fold: raise 10:21:31.729Z, released 10:21:37.095Z, public fold 10:21:38.417Z; raise 10:28:21.462Z, released 10:28:24.916Z, public fold 10:28:28.369Z. One further big blind folded 3 ms after the raise that priced it (raise 10:20:48.553Z, public fold 10:20:48.556Z, release recorded 10:20:48.598Z), which is a queued decision and not a live click.
- One lightning_hand_player row per hand for that player and one fold per hand: no duplicate seating, no second fold.
- One pre-action check on the flop (hand 23f00e1c, 10:30:48.807Z). No hand in the sample shows pre-action checks on two or more streets.

What this does and does not establish. The rows are consistent with Check/Fold releasing a priced blind at once and folding publicly in turn. The database does not record which button was pressed, so they are equally consistent with the Fold button and are not proof of a Check/Fold press. Cross-street carry of one press has NOT been observed on production: it is covered by the engine tests (LightningHandHost.test.ts and LightningCheckFoldCarries.test.ts, including the 40 seeded hands with more than 20 carried checks) and the client tests only. The table-change motion has not been watched on a live table by this lane; tests do not establish that it looks smooth.

Outstanding live observation (a person at a Lightning table on client 884b85df or later, engine 840429a3 or later): (1) in the big blind of an unraised hand press Check/Fold once and leave it; it should check each street and stay lit until a bet folds the hand or showdown; (2) in the small blind press Check/Fold; the next hand should arrive at once; (3) watch the table change after a fold and after a showdown for cards, pot, seats and controls arriving together. No supported route does this without a funded player, and none was built (CLAUDE.md 11.5). After item 1 is played, the carry can be confirmed read-only as origin pre_action checks on consecutive streets of that hand.

Left with their owners: issue #10246 and the unrecorded migration 20261109040704 (comment 6761066024); the 0440z booking-record check failure. Shared clone origin unchanged.

## Live owner session and corrections, 2026-11-10 15:41Z to 16:50Z (same session)

Correction to the post-cutover section above. folded_at is written when the engine accepts the fold request; an armed Check/Fold priced by a bet is released inside the same applyAction as that bet, so it appears within database-write latency of the raise. The two big-blind releases listed above came 5.366 s and 3.454 s after their raises: each was a separate press after the raise, not an armed release, and says nothing about engine delay. The third (public fold 3 ms after the raise, origin player) matches an earlier fast Fold published at its turn, not Check/Fold. No post-cutover hand showed the armed release at a raise.

Direct owner observation (Dan, Lightning table 8122f139, player ...2af765, client 884b85df then later, engine 840429a3): "check fold is working correctly now" for the ordinary and small-blind cases. In the big blind he reported it did not release him on a raise and, at his turn, the lit Check/Fold cleared and he had to press Fold. The rows confirm it:

- Hand 58348210 (formed 15:45:53.880Z, BB): horse raise 15:46:09.649Z; hero fold 15:46:27.514Z origin player, fold_type normal (a manual click). The engine held no pre-action at the turn (runPreAction records origin pre_action).
- Hand 58348362 (formed 15:47:43.147Z, BB): horse raise 15:47:49.462Z; hero fold 15:47:53.303Z origin player, fold_type fast, folded_at 15:47:53.300Z: a pending fast fold from an unpriced seat, published at the turn and not released by the raise.

Root causes being fixed in a separate change: the bar decides "owes nothing" from render-time table state but "can check" from a ref, so a lagging posted blind sends auto_fold instead of auto_check_fold; the engine holds a fast fold from an unpriced seat until its turn and releasePricedCheckFolds skips pending folds; and an arm the engine refuses can stay lit. Engine part activates at the next 04:00 America/Chicago window.

Other findings from the same session, each with its own owner change: the Charles Rule compared the post-rake stack with 2 x the reference (228.12 against 228.92 after a 0.80 rake); blind and button assignment let one player take the small blind three times in about 30 s; the action bar remounted on every action (fixed and live, #10363, served in 708e42bb); and the joining and fold-to-next-hand delays traced to a tournament settlement lock storm (#10361), not to the Lightning path (fold ack p50 about 1 ms, release about 83 ms, deal to screen 61 to 97 ms; the remaining wait is for five other free players).

Still to observe after the big-blind fix is live: one big-blind press of Check/Fold carried to a raise (release within write latency of the raise) and one carried across streets (origin pre_action checks on consecutive streets of one hand).

## Authoritative state, 2026-11-11 09:20Z (same session; supersedes the "still to observe" lines above)

### Deployed identity

- Engine: `05ab41c30fc21a8a98001827e9921ffc314b81e7`, instance `1-0c51ab22`. It was sealed and thawed by the sole operator (root `01a1bbdd`) for window `2026-11-11-horse-clock-receipts-engine-0050z`: Stage `42965274517`, receiver `42965360845`, SEALED at 05:39Z (PR #10063 comment 6788073609). This lane dispatched nothing.
- Contains, by ancestry: #10369 `8e5dda8d` (big-blind release), #10370 `45aa74d7` (arrival window), #10373 `2a48e027` (fairness model), #10392 `b04f633a` (Lightning DB lane), #10395 `fb1542cf`, #10411 `40ba9628` (lane safety), #10397 `f1fae9f1` (pre-action record), #10399 `1c06524d` (thin-pool model), #10417 `465addd2` (pool-count frame removed).
- Client: both build-info endpoints serve `59785369` (publisher run 42934481765). This includes #10410 (no seat from the waiting count), #10426 (join retry timed as its own attempt) and #10412. The earlier publish failure for `465addd2` (run 42928971472) was an older run switching the origin after a newer one had published (filed as #10425). The served bundle was confirmed correct: `git diff --name-only d979f8a8 17a90c8d` changes only server (11), docs (2) and tests (1), and run 42931049915 recorded verdict `retained`.
- Database: applied `20261110213713` (lane role and wrapper), `20261110213942` (pre-action record), `20261110213810`/`20261110225742` (join timing), `20261110155259` (Charles Rule), `20261110160345` (table_seats statistics). NOT yet applied: `20261110173033` (fairness) and `20261110214134` (thin-pool, guarded to refuse without fairness). Both are daily-window files; the installer is due at 09:30Z.

### Observed behavior

- **Database lane (observed live).**
  - Metrics: `poker_lightning_lane_ready 1`, `disabled 0`, `committed_total 29,679`, `unknown_total 0`, `rolled_back_total 1`, `admission_refused_total 203`. The 203 are pool-full fallbacks before send, which is the allowed case.
  - `pg_stat_activity` showed 6 `engine_lightning_lane` sessions, idle between calls (role connection limit 16).
  - 05:34Z to 06:04Z: 3,281 hands formed and 3,237 settled, with 0 duplicate formation request ids, 0 duplicate settle request ids, and 0 hands left unsettled past 5 minutes.
  - Retry rule as deployed (#10411): only a call never sent may fall back to PostgREST. A confirmed rollback is reported and settled by its own request id; an uncertain outcome is never resent blindly.
  - Connection isolation only: CPU, I/O and locks remain shared with tournaments (measured relation overlap and a small-burst load sample are in the lane changelog).
- **Pre-action record (deployed, no live sample).** `lightning_preaction_event` has 0 rows. No non-horse player played Lightning after activation; horses do not use pre-actions.
- **Join timing (natural browser samples, as of 01:00Z).** 2 joins: 1 succeeded, 1 refused at click with `PLATFORM_FROZEN` during this release's freeze, 0 abandoned. The successful join took 11,884 ms from click to cards: 9,357 ms the player deciding, 2,527 ms system. Every system stage was 65 to 494 ms, and the pool wait was 0. p50, p95 and p99 are unknown (n=1). No bottleneck is shown.
- **Arrivals.** Client never draws a seat from the waiting count (#10410, live). The engine no longer sends that count (#10417, serving). Not yet observed on a live human table change.
- **Fairness and thin-pool.** No 4-handed tables (expected before the migrations install). Last 35 minutes before 06:04Z: 76 five-handed tables.

### Owner's observed hands (2026-11-10 15:41Z to 15:50Z; engine `840429a3`, client `884b85df`)

- They prove the ordinary and small-blind Check/Fold release on that revision.
- They show the big-blind failure in hands 58348210 and 58348362 (root causes fixed in #10369 and the engine change in the serving engine).
- They show the double-up miss that led to the Charles Rule fix.
- They do not prove behavior on engine `05ab41c3`.

### Evidence still owed

1. Both matcher migrations recorded in `schema_migrations` in order (fairness before thin-pool) and present in the live function images, then natural 4- and 5-player formations with blind and button assignments.
2. Three live owner hands on engine `05ab41c3`, pending because no authorized live session exists and no chips are spent or actions taken on the owner's behalf:
   - a big-blind Check/Fold carried across streets until a raise, with release at that raise;
   - a small-blind Check/Fold releasing at once;
   - one table change after a fold and after a showdown.
   Each is then traced with `fn_lightning_preaction_trace(hand_id)` and the hand rows.
3. Join timing percentiles once enough natural browser joins exist.
