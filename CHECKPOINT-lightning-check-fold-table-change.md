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
