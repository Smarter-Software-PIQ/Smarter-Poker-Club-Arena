# Mongo Lightning hole cards never shown, 2026-11-09

Owner chat: Claude session 01BNteGXRtP69QdCwHytb9hL (two owner messages, 13:42 and 14:58 America/Chicago).
Scope: Mongo's report that Lightning NLH hand 58167350 never showed his hole cards; root-cause fix and hardening of hero-card custody in the table client; protected merge, client publication, live verification; owner-approved 0.25 chip reimbursement. Client only, no engine change, no engine window.
Policies: portable `docs/agent-policy/` read in full at 2026-11-09T20:58Z and checked again at 22:45Z, version 2.9, hashes owner 73c17bed, operating a8bc3c04, hardening d5fc451c, index adce89c3. The Mac canonical copies under `/Users/smarter.poker/Documents` were not readable from this cloud session (folder access refused); the portable copies governed.

## Cause, stated at the level it is known

The engine dealt and settled hand 58167350 correctly (`lightning_hand_player`: seat 1, small blind, `fold_type normal`, net -0.25, folded 31 s after formation). The cards were lost in the client. The exact frame order on Mongo's phone was not recorded and remains unproven. Four defects that each leave a dealt-in Lightning hero holding nothing were reproduced and corrected:

1. the snapshot hold found the hero by seat index (Lightning changes the seat every hand);
2. HAND_STARTED kept already-delivered cards only if the deal sound cue had been written;
3. a Lightning room had no recovery (`heroCardFetchRef` was null there);
4. a delivery arriving before the page knew its player (`userId` still `'guest'`) was discarded. Found by the browser suite and confirmed with an instrumented build. It cannot be Mongo's hand (he had been in the room six minutes).

Detail: `docs/changelog/2026-11-09-the-hero-always-holds-the-cards-they-were-dealt.md`.

## Delivered

- Client: PR #10215, squash `ef737b9c7eee3acf23e5bb6470f3561fba6200aa`, merged 2026-11-09 about 22:27Z after 62 of 62 completed checks succeeded on head `a2175073` (three earlier heads failed on harnesses and a source-window rule this change had to satisfy; each was read and fixed).
- Published: `https://ca-static.smarter.poker/build-info.json` and `https://smarter.poker/hub/club-arena/build-info.json` both returned `ca_sha ef737b9c...`, `built_by publish-club-arena.yml`, run 42711995410, built 22:32:25Z (read 22:39Z).
- Reimbursement: PR #10233, squash `1f1863c4`, migration `20261109212039_the_house_returns_mongo_the_blind_he_posted_without_seeing_h`, installed by Apply Merged Migration run 42708421018 at 22:06:10Z.

## Acceptance evidence

- Law `tests/the-hero-always-holds-the-cards-they-were-dealt.law.test.ts`: executes the page's own snapshot merge, delivery door, replay effect and HAND_STARTED reset. Fails on the pre-fix page source.
- Browser `tests/live-turn/lightning-hero-cards.pw.ts` (390x844 touch viewport, signed-in fixture player, Lightning room, engine socket answered in the browser), six cases:
  - pre-fix build `de2e7976`: 6 of 6 fail;
  - candidate build: 6 of 6 pass, Chromium (three runs) and WebKit;
  - the published bytes of `ef737b9c`, downloaded from `ca-static.smarter.poker` (index plus 736 assets) and served locally with every request intercepted: 6 of 6 pass, Chromium and WebKit. For that run only, the mock backend answered the production Supabase host name locally; nothing reached production.
  - It runs in CI as "Lightning hero cards gate".
- Reimbursement readback (22:10Z): adjustment `e37c0928` settled 0.25; `chip_ledger` `430b85c5` union_bank fade0000 to player_wallet d55730d2, club a41434bb, 0.25; `wallet_credit_idempotency` key present once; `wallet_transactions` `e1b0234a` credit 0.25; wallet 115.17 to 115.42; union bank 146706042.23 to 146706041.98; alert `a6da27c2` resolved; `lightning_hand_player` row unchanged (-0.25, normal). No earlier reimbursement existed. Probe before merge aborted as designed and read back clean.

## Limits

- No physical phone. WebKit here is the desktop engine in a phone-sized viewport, not iOS Safari: iOS audio session, backgrounding and network handover are not covered.
- No live Lightning hand was played on production as a seated player (it would spend real chips, CLAUDE.md 11.5).
- The workflow outcomes that line left unread were read at 23:03Z; see the next section. Not every post-deploy check reached success.

## Workflow outcomes, read 2026-11-09 23:03Z

Read through the Mac's built-in browser, signed in to GitHub as `Smarter-Poker` (run, job and step data, and the step log for the one failed step).

- `Publish Club Arena` run 42711995410, head `ef737b9c`, attempt 1: completed, **success** (22:27:08Z to 22:33:52Z).
- `Post-Deploy E2E ef737b9c` run 42713002169: completed, **cancelled** at 22:42:51Z. Succeeded before the cancel: "Confirm The Hetzner Web Publish Reached Production", "Installed certification cleanup protects live tables", "The Live SEO Contract Holds". Cancelled 6 minutes in: "Live-table and engine verification" and "Client browser verification". The next publish (`e603a0cd`, 22:38:53Z) superseded it. Of the 30 most recent Post-Deploy E2E runs, 21 ended cancelled this way.
- `Post-Deploy E2E e603a0cd` run 42713958246 (`e603a0cd` contains `ef737b9c`): the three jobs above succeeded again, and **"Live-table and engine verification" succeeded** (22:46:50Z to 22:59:08Z). "Client browser verification" was still running at 23:03Z with one step already failed: "Certify the authenticated Lightning operator cold loads". Its log: `production-lightning-operator.spec.ts` at 393px expected HTTP 200 and received 500 from the operator read; the same case at 1440px passed, and both "Join Lightning from the lobby" cases passed. The API log has one 500 on `/rest/v1/rpc/fn_lightning_operator_overview` at 23:00:53Z, inside a window with 253 other 500s on `/rest/v1/tournament_schedules`. That is a database response, not table-client code, and this change touches neither. The job's final conclusion was not available when this was written; with a failed step it will not be success.
- Baseline for that job before this change: `Post-Deploy E2E ae8a00bb` run 42699314895 (created 21:06Z) already ended **failure** in "Client browser verification", on "the mobile lobby chrome on production > tournament favorites stay below current pins across sorting and reload" (Chromium and WebKit).
- `Club Create Certification` for `ef737b9c` run 42713002038: **failure** in "Certify Authenticated Club Creation And Cleanup". It failed on every revision read since `ae8a00bb` at 21:04Z, before either merge of this task.

So: the publication workflow succeeded and live-table and engine verification succeeded on a revision containing the fix. Client browser verification and Club Create Certification did not pass; both were already failing before this change, and the one new failed step is a database 500. Nothing in those results points at this change, but they are not passes and are not reported as passes.

## Outside findings, not acted on

- Post-Deploy "Client browser verification" (lobby favorites case), `Club Create Certification`, the `fn_lightning_operator_overview` 500 and the burst of 500s on `tournament_schedules` around 23:00Z are red or erroring on main independently of this task.
- "Installed and merged migrations agree" was red on every PR from about 21:24Z: four directly applied versions (20261108212225, 212338, 212419, 212519) aged past the 24 h grace with no file or alias. It is not a required check and was green on main again by 22:04Z. Their four Apply Merged Migration runs at 22:04Z failed; that lane owns them.

## Cleanup

Owned worktrees and build directories in the cloud session removed at close. Branches `fix/hero-always-holds-dealt-cards-20261109` and `fix/mongo-lightning-blind-make-good-20261109` are merged. Nothing was created on the Mac.
