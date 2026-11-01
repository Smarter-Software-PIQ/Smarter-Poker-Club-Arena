# HANDOFF PROMPT: Club Arena Horse Hold'em upgrade + engine release (state at 2026-11-01 14:30 UTC)

You are taking over a live, multi-session engineering programme on the Club
Arena poker platform (owner: Dan, "Smarter.Poker"). Read this whole document
before acting. It is written so you can continue exactly where the previous
agent (session `session_01UxDLnHnx26Xg61aTqEtpEp`) stopped. Every fact below
was read from GitHub, production health or the production database (SELECT
only) at the time stated; re-verify anything time-sensitive with one call
before acting on it (CLAUDE.md 10.86: date every environment claim).

---------------------------------------------------------------------------

## 0. MISSION AND OWNER ORDERS (verbatim, binding)

The mission: make the Hold'em horses (AI players; never call them "bots") the
best NL cash and tournament players, fully wired, tested, merged, RELEASED and
verified live; never claim success without verification; never idle; report
each workstream separately as implemented / qualified / merged / verified live.

Owner messages in this programme (America/Chicago times):

- 2026-10-31: "LAUNCH A SWARM ... FINISH ANY AND ALL TASKS USING THE FASTEST,
  MOST EFFICIENT ROUTE ... DO NOT DO ANY UN NECESSARY TESTS, OR WORK OUTSIDE OF
  THIS SCOPE."
- 2026-10-31: "YOU CAN DEPLOY AT THE NEXT :55 BREAK, YOU DO NOT HAVE TO WAIT
  UNTIL 4AM" (basis of owner window #9015, now expired).
- 2026-10-31: "AUDIT AND IMPROVE THE HORSES OPENING RANGES IN BOTH TOURNAMENTS
  AND CASH GAMES ... MAKE SURE THEY ARE FULLY ACTIVATED AND LIVE".
- 2026-10-31 21:44: "HORSES KEEP MAKING THESE WEIRD 4 BETS ANYTIME I 3 BET, THEN
  FOLD 100% OF THE TIME TO A FIVE BET. YOU NEED TO FIX THIS AND STOP 4 BETTING
  POTS IF THEY ARE FOLDING. ITS SPEWING CHIPS. AND WHY ARE ALL HORSES MIN
  RAISING WHEN THEY ARE OPENING... OPENING RANGES SHOULD BE RANDOMLY DONE, MIN
  RAISE TO 2.5-4X OPENING RANGES. NOT ALWAYS THE MINIMUM RAISE POSSIBLE"
- 2026-10-31 21:50: "NO ITS IN THE SATURDAY MYSTERY BOUNTY 30 TOURNAMENT"
- 2026-10-31 23:35 (governing instruction for this phase):
  "Keep all existing workstreams moving: opening-range audit, randomized opening
  sizes, facing-3-bet defense, V71, the 4-bet correction, and the
  census-timeout/freeze-recovery blockers. Report each separately as
  implemented, qualified, merged or verified live. Establish the current release
  owner, serving revision and durable release state before acting. Coordinate
  directly with the relevant sessions to identify the cancellation reason.
  'Canceled by @Smarter-Poker' identifies the account, not which session or why;
  do not assume interference or override a legitimate safety cancellation.
  Preserve one deployment owner and use the supported release route, required
  checks, certified cutover, rollback and thaw safeguards. Recheck #9065's
  strategy before activation ... Reconcile the conflicting rules using stack
  depth, sizing, pot odds and tournament context ... Finish the opening-size and
  defense changes without hand-strength sizing tells or unsupported blanket
  frequency targets. Preserve short-stack legality and tournament constraints.
  Verify the actual deployed revision contains each fix, then measure live
  opening sizes, 3-bet defense and 4-bet/5-bet decisions against the recorded
  baselines. Confirm fleet health, resumed hands and a complete thaw. Reuse
  valid evidence, run only necessary checks, and report exact blockers without
  calling merged code live."
- 2026-11-01 00:45: "BURLS IS COMPLAINING ABOUT HOW THE HORSES ARE NOT RAISING
  MUCH IN THE CASH GAMES, THEY ARE LITERALLY MIN RAISING IN A CASH GAME THAT
  DOESN'T HAPPEN. THEY ALWAYS RAISE A LITTLE MORE IN CASH GAMES. (REAL PLAYERS
  THAT IS)"
- 2026-11-01 07:29: "FIX ANY AND ALL BLOCKERS NOW AND FINISH THIS UP, PUSH AND
  PUBLISH EVERYTHING. THEN AND ONLY WHEN ITS DONE PUSHED AND PUBLISHED ... GIVE
  ME A MILITARY GRADE HANDOFF PROMPT".
- Recorded in another session (platform-health, `session_01UxDLnGkMy6P1dzYLqDzBRr`),
  2026-11-01 07:28: "YOU DECIDE WHATS BEST, AND HOW TO RESOLVE THE ISSUES." (the
  basis of decision #9134; quoted in its changelog).
- Earlier standing preference: "DON'T STOP BECAUSE YOU ARE WAITING ... WORK ON
  SOMETHING ELSE ... NEVER BE IDLE".

**Bottom line at handoff: every horse change below is MERGED on protected main
but NOTHING from V61-V74 / rule 4 is LIVE.** Production still serves the
2026-10-29 engine `eed06fe51dea622069c661a6213d5b031ff3a9e3`, which cannot
currently be replaced (section 4). Do not tell Dan anything is live until
`https://engine.smarter.poker/health` -> `releaseSha` contains it.

---------------------------------------------------------------------------

## 1. ENVIRONMENT, ACCESS AND RULES YOU MUST FOLLOW

### Repos, paths, tools
- GitHub repo: `Smarter-Software-PIQ/smarter-poker-club-arena` (the API also
  answers as `Smarter-Software-PIQ/Smarter-Poker-Club-Arena`; "This repository
  moved" notices on push are harmless).
- Previous agent's container (ephemeral, may not exist for you): shared clone
  `/home/claude/smarter-poker-club-arena` REFUSES commits (guard-shared-clone);
  always work in a linked worktree:
  `git fetch -q origin main && git worktree add /home/claude/wt/<name> -b <branch> origin/main`
  then symlink deps: `ln -s <clone>/node_modules <wt>/node_modules; ln -s <clone>/server/node_modules <wt>/server/node_modules`.
  If `git fetch` fails with "cannot lock ref", wait 2 s and retry (concurrent fetches).
  Disk was tight (62-75% of 252 GB); remove merged worktrees (`unlink` the
  node_modules symlinks first, then `git worktree remove`).
- `gh`: **GraphQL is blocked** in these sessions. Use REST only:
  - create PR: `gh api repos/Smarter-Software-PIQ/smarter-poker-club-arena/pulls -f title=... -f head=<branch> -f base=main -f body=...`
  - auto-merge: `gh api -X PUT repos/Smarter-Software-PIQ/smarter-poker-club-arena/pulls/<n>/ccr/auto_merge -f merge_method=squash`; disable: `gh api -X DELETE .../pulls/<n>/ccr/auto_merge`
  - update branch: `gh api -X PUT .../pulls/<n>/update-branch`
  - checks: `gh api ".../commits/<sha>/check-runs?per_page=100" --jq ...`
  - job logs: `gh api .../actions/jobs/<id>/logs`
  - rerun failed jobs (only for proven flakes): `gh api -X POST .../actions/runs/<run>/rerun-failed-jobs`
- Production database: Supabase project **`kuklfnapbkmacvwxktbh`**
  ("PokerIQ-Production"), via `mcp__Supabase__execute_sql`. **SELECT only.** No
  DDL, no probes, no writes, no RPC that writes, no `apply_migration`.
  Migrations reach production only from protected main through
  `apply-merged-migration.yml` / the window installer (CLAUDE.md section 2
  rules 1-11).
- Engine health (public JSON): `https://engine.smarter.poker/health`. Useful
  fields: `releaseSha`, `uptime`, `bootPhases.processStartedAt`,
  `maintenance.{active,phase,readyForRestart,unparkedTables,unparkedReasons,breaksSinceRestartCertified}`,
  `handsInFlightTotal`, `memory.rssMb`, `liveness`, `stalledTableCount`
  (unreliable; see #9057), `totalHandsDealt` (NOT monotonic, do not use).
- Commit trailers (every commit):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/<your session>`.
  PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
  a blank line, then the session URL.
- Never `--no-verify`. The pre-push hook runs related tests (minutes).

### Binding laws that shaped this work (read CLAUDE.md in full; highlights)
- **10.5 Horses are players.** Never key strategy on horse/human labels.
  Every opponent gets one policy; observed public play (reads such as maniac)
  may adapt it. Laws pin "identical answers when labels are flipped".
- **No hand-strength sizing tells** (Dan, 2026-10-31 23:35): sizes must be
  drawn independently of the cards.
- **No blanket frequency targets**: justify ranges by seat, position, price,
  depth, and the format (cash or tournament).
- **Short stacks / tournaments**: push/fold at 20bb or less is left to the
  brain; `HorseTournamentShoveDiscipline.ts` (Dan 2026-10-25) caps tournament
  shoves (open <=12/15/20bb by seat, 3-bet shove <=25bb, 4-bet shove <=40bb);
  Oct 25 deep 5-bet discipline (at 60bb+ effective in tournaments only AA/KK
  stack off FACING A 4-BET).
- **Dan 2026-10-25 premium rules** (`HorseHoldemPremiumAggression.ts`):
  rule 1 dominated offsuit hands fold to a big 3-bet; rule 2 premiums never
  play passively (QQ+/AK raise); rule 3 premiums keep betting postflop.
- **Release laws**: one deployment owner; only the supported route
  (`stage-engine-release.yml` -> `auto-deploy-hetzner.yml` ->
  `engine-release-transaction.sh` on the host); no second publisher, timer,
  watcher, retry/repair loop, manual restart, manual thaw, or cancels you were
  not explicitly authorised to make; pinned constants unchanged (120 s lead,
  300 s freeze, 285000/260000/245000 ms certificate ladders, 135 s, 40 s
  checkpoint incl 5 s cleanup, 20 s MAIN with 5 s remote close, v3 thaw).
- Daily engine maintenance (CLAUDE.md 13): routine engine releases activate
  only at 04:00 America/Chicago (CST since 2026-11-01 -> 10:00 UTC). Owner
  ":55 windows" need an explicit owner order recorded in
  `server/release/owner-maintenance-windows.json` +
  `server/release/activation-floor.json` (see #9015, #9106, #9139).
- The permission classifier in this environment refuses: production DB
  writes (e.g. thaw RPC), cancelling workflow runs without explicit user OK,
  subagent dispatch of apply-merged-migration. Do not work around it; ask Dan.
- Laws registry: every `*.law.test.*` needs `docs/laws.d/<file>.md`
  (tests/law-registry.law.test.ts).

---------------------------------------------------------------------------

## 2. CURRENT STATE SNAPSHOT (2026-11-01 14:27 UTC)

- Serving engine: `eed06fe51dea622069c661a6213d5b031ff3a9e3` (since
  2026-10-29), liveness ok, ~236 hands in flight, RSS ~7.4-10 GB, maintenance idle.
  It **crash-restarts on its own** on the same image roughly every 1.5-2 h
  (2026-11-01 02:19, 03:50, 05:19, 08:15, 09:42, ~12:38, ~14:04 UTC). Hands resume each time.
- Protected main head: `241d09027c` (#9147, 14:25 UTC). Main contains ALL of the
  horse work: V61-V74 and rule 4 (verified with `git merge-base --is-ancestor`).
- Release owners active on this account (other Claude sessions; you cannot
  message them directly, only via PR/issue comments):
  - platform-health session `session_01UxDLnGkMy6P1dzYLqDzBRr`: owner window
    #9106 (crash-loop fix, 07:05-09:25 UTC, daily fallback) - its receiver
    41283363258 (target e9f00025bd) did intake at 07:19:54, the 07:55 break ran
    without certificate, no 08:55 notice, then "release intake exhausted its
    shared wall-clock budget" at 10:27 (failed:reattach, exit 70). Authored the
    deadlock analysis #9133 and decision #9134.
  - session `session_01UxDLnHHq4dGvwAGS1AsGoP`: PR **#9139 MERGED 14:30:30 UTC
    (`b194c1db64`)**: door allowlist for the abort function + owner windows 70/71,
    14:30-20:25 UTC 2026-11-01, containing `4e9c3228`; window 71 installs the
    queued window migrations `20261101004247` (#9073) then `20261101005048`
    (#9054) inside the first confirmed freeze.
  - another session: PR **#9150** (open): a database-only owner window
    (14:10-18:00 UTC) to install migration 05048 alone.
- Cancellations: receivers 41265707411 (02:52:07), 41265850224 (02:52:25),
  41268776862 (03:36:51) were cancelled by "@Smarter-Poker" (manual; the
  account, not which session). Withdrawal 41266658303 (02:48) targeted
  41265707411-1 (desired eed06fe5) and failed `read_unavailable`. No written
  reason found anywhere (PR/issue comments, changelogs, branches). Do not
  assume interference.

---------------------------------------------------------------------------

## 3. WORKSTREAMS, PHASES AND SUB-PHASES (what is done, where, and status)

Status legend: IMPLEMENTED (code written) -> QUALIFIED (tests/CI green) ->
MERGED (protected main) -> LIVE (serving releaseSha contains it, verified).
Nothing below is LIVE.

### Phase A - Postflop leak fixes V61-V69 (MERGED, not live)
Origin: weekly leak report `docs/horse-measure/2026-10-31/horse-leak-report-2026-10-31.md`
(cash/MTT weekly: turn one-pair calls -308k/-185k; flop bet-raised call one
pair/air -241k/-163k; turn bet-raised call -179k/-111k; river one-pair
bet-raised call -129k/-47k; turn air/draw calls -62k/-25k).
| V | PR | merge | what | option flag |
|---|---|---|---|---|
| V61 | (Oct 30 window #8744) | - | river one-pair call shade | `v61RiverOnePairShade` |
| V62 | #8733, #8781 | 6be474bff1 / 97339808c3 | river bettor polarity, opt-in (league negative) | `v62RiverBettorPolarity` |
| V63 | #8851 | 7cb5fffc95 | river one-pair shade keeps climbing to 20 pts vs large wager (knee, cap 0.20) | `v63LargeRiverBetShade` |
| V64 | #8874 | 941a3b5f72 | a bluff-catcher never raises the river | `v64RiverRaiseNeedsTwoPair` |
| V65 | #8885 | cc8e09294c | turn one-pair calls shaded by price | `v65TurnOnePairShade` |
| V66 | #8875 | 97485fe12d | one pair that bet flop/turn and was raised priced vs raise | `v66BetRaisedOnePair` |
| V67 | #8893 | 412bafe0f3 | river bet-raised one pair (raise range 10% bluff/75/22/3, shade +0.10 cap 0.25); decide strength after live data | `v67RiverBetRaisedOnePair` |
| V68 | #8892 | 3c44fcbcde | high-card turn calls stop buying unpayable implied odds | `v68TurnAirDrawCalls` |
| V69 | #8902 | 0562b8d49c | three turn-call gaps left by V65/V68 | `v69TurnCallGaps` |
Baseline for re-measurement: `docs/horse-measure/2026-10-31/horse-v63-v69-baseline-2026-10-31.md`,
tool `scripts/horse-measure/horse-v63-v69-measure.py` (usage in its header).

### Phase B - Preflop (MERGED, not live)
**B1. V70 GTO opening ranges** - #8995, merge `61229f0de1`.
`server/src/engine/HorseGtoOpeningRanges.ts` (seats-behind indexing), flag
`v70GtoOpeningRanges`, receipt `v70_gto_open`. Audit:
`docs/horse-measure/2026-10-31/horse-rfi-live-2026-10-31.md` (49,130 hands,
153,706 horse unopened decisions; main cash leak was SB too tight, SB open
2.16bb). Tool `scripts/horse-measure/horse-rfi-live.py`.

**B2. V71 ante-aware Nash push/fold (<=15bb)** - #9035, merge `269d39399a`,
flag `v71AnteAwarePushFold`, receipt `v71_ante_push`.

**B3. V72 defence facing one open, by opener seat** - #9041, merge
`1a1e26fbaa`. `HorseGtoDefenceRanges.ts`, flag `v72DefenceByOpener`, receipt
`v72_defend_vs_opener`, `V72_BLUFF_TRIM = 0.5`. League: no card below -2 stderr.

**B4. V73 opener's answer to a 3-bet** - #9088 (`ac55bc160c`) + #9094
(`891f805d6c`, price-derived width per owner constraints).
`server/src/engine/HorseGtoVs3BetRanges.ts`, option `v73Vs3BetDefence`,
receipt `v73_vs3bet_defence`; law `HorseVs3BetDefence.law.test.ts`
(`docs/laws.d/the-opener-facing-a-3-bet-keeps-the-owner-rules.md`).
Applies: hero made the only open, exactly one 3-bet, no callers, NLH, >=3
dealt, >=25bb, 3-bet 1.8x-7x the open, 3-bettor not all-in. Width = share of
own seat's opening range = MDF x equity multiplier (MDF = P/(P+R)). Multipliers
IP: BTN 1.50, CO 1.62, HJ 1.75, LJ 1.88, UTG+2 1.95, UTG+1 1.98, UTG 2.01;
OOP: SB 1.32, CO 1.44, HJ 1.52, LJ 1.61, UTG+2 1.67, UTG+1 1.70, UTG 1.72;
other prices scale by sqrt(ratio to reference MDF) in [0.7, 1.4]; depth up to
+15% at 25bb, down to -5% past 120bb. Hand order from late/early reference
charts (pairs, suited hands, AKo, AQo only; rule 1 folds the rest). Only
continue-vs-fold changes, no sizing. Measured before (3 h to ~03:00 UTC
11-01): tournament fold 68.3% / call 18.5% / 4-bet 13.2% (n 2,937); cash
73.0 / 17.8 / 9.2 (n 1,017); by seat at 25bb+ tournament BTN 87.4, CO 76.4,
HJ 73.2, LJ 69.2, UTG 43.3, SB 89.7; cash BTN 84.7, CO 75.2, HJ 67.8, UTG 59.5.
Harness after (fold %): cash 100bb BTN vs BB 74.3->54.5, BTN vs SB 73.2->55.0,
CO vs BB 57.2->46.4, UTG vs BB 41.6->39.3, SB vs BB 79.5->61.2; MTT 50bb ante
BTN 82.2->54.8, HJ 66.8->41.8, UTG vs BB 48.8->28.1; MTT 30bb BTN 80.7->52.1;
cash 250bb BTN 81.1->56.0. 4-bet share identical on/off. Live check after
release: `v73_vs3bet_defence` against `decide_nlh` (alarm floor 0.002), rerun
the by-seat query (section 6).

**B5. Rule 4 - no hold'em 4-bet is ever made to fold** - #9065 (`4d3d19a7e2`)
+ price-aware refinement #9093 (`258d5eff18`), in
`server/src/engine/HorseHoldemPremiumAggression.ts` (final `wager_rules`
node in HorseLogic and again at commit in ServerTableEngineTurns).
- Reported hand: Saturday Mystery `329aa86f-08a9-46f1-8916-59c230aca349`,
  hand 53158209 (2026-11-01 02:03 UTC, 75/150, ~107bb): horse opened QQ to
  466, Dan (seat 1, user 47965354-0e56-43ef-931c-ddaab82af765) 3-bet 1,631,
  horse 4-bet 3,751, Dan jammed 39,870, horse folded QQ. In that event horses
  4-bet 6 of 9 three-bets faced, all value (AA, KK, KK, QQ, QQ, AKo).
- Cause: rule 2 forces QQ/AK to re-raise a 3-bet; the brain's Oct 25 deep
  tournament 5-bet bar (`HorsePreflop.ts` raises>=3 branch: at >60bb only
  premium pairs continue) also covered the player who MADE the 4-bet; plus the
  V7 4-bet-bluff band folds to a 5-bet by design.
- 4a: a sized re-raise over a 3-bet or more only with QQ+/AK that can call the
  jam it invites; other hands call (rule 1 still folds dominated offsuit);
  QQ/AK too deep flat (`premium_flat_deep_three_bet`); all-in re-raises and
  <=20bb push/fold untouched.
- 4b: a horse whose own 4-bet was re-raised calls (AA/KK jam via rule 2) when
  the price allows; with 4a that is every 4-bet it made unless the re-raise
  comes from a deeper stack than the one it 4-bet into (e.g. a third player's
  cold 5-bet).
- Price (`fourBetCommits`): required = (S - F) / (D + 2S) (+0.03 in
  tournaments); equity vs a solver-style jam range: AA 0.85, KK 0.65, AKs 0.45,
  QQ 0.44, AKo 0.43, JJ 0.42, TT 0.40, else 0.35; maniac read +0.10. Over a 9bb
  3-bet: QQ 4-bets/calls off to ~178bb cash / ~120bb MTT, AKo ~152/108, AKs
  ~214/136; deeper they flat. Recorded hand needs 0.41 -> calls.
- Receipts: `holdem_no_four_bet_bluff`, `holdem_premium_flat_deep_three_bet`,
  `holdem_four_bettor_continues`. Worker receipt validation
  (`server/src/engine/horseDecision/responseValidation.ts`, `holdemFourBetSpot`)
  admits exactly these raise->call / fold->call de-escalations, context-bound.
- Departures from Dan's literal words (explain if asked): deep QQ/AK flat a
  3-bet (Oct 25 rule 2 said never flat) because the only re-raise would be the
  4-bet-then-fold he banned; a 4-bettor may still fold to a re-raise from a
  deeper stack than it 4-bet into (price decides).
- Tests: `HorseHoldemPremiumAggression.law.test.ts` (recorded hand, 100/200/250bb
  cash, 100/160bb MTT counterexamples, brain never 4-bets QQ/AK/JJ/A5s at
  200bb, receipts valid); `plo6RiverDisciplineReceipt.test.ts` list without NLH.

**B6. V74 randomized open sizes** - #9116 (`abdf87c31e`) + premium-open no-tell
#9131 (`fef335020f`). `server/src/engine/HorseNlhOpenSize.ts`, flag
`v74NlhOpenSizes` (default on; NOTE another session separately used "V74" for
`v74OmahaSemiBluffNeedsDraw` #9012 - number your next feature V75+), law
`HorseNlhOpenSize.law.test.ts` (`docs/laws.d/server-src-engine-HorseNlhOpenSize.md`).
- Root causes found by harness through HorseLogic.decide: (1) the V28 ladder
  drew 2.2-3.0bb (2.05-2.40 ante), -0.15 late, x persona 0.88-1.12 -> many
  draws under 2bb clamped to the min-raise; (2) `legalize` floors to whole chips
  at an integer big blind, so 2.00-2.99bb became 2bb.
- Cash (Dan 11-01 00:45): never under 2.5bb (`NLH_CASH_OPEN_FLOOR_BB`); 100bb
  bands early 2.8-3.5, middle 2.7-3.3, cutoff 2.5-3.1, button 2.5-3.0, SB
  3.0-3.5, HU 2.5-3.0; full ring early +0.25; >150bb up to 4bb; ante bands
  smaller; <=25bb 2.5-2.8. Tournaments: >25bb 20% exact min-raise
  (`NLH_TOURNAMENT_MIN_RAISE_SHARE`), the rest from smaller bands; 25-40bb
  capped 2.5bb (SB 2.8); <=25bb 2.0-2.3bb hard ceiling. +1bb per limper,
  stochastic rounding onto the chip grid, exactly three rand() draws, never
  reads the cards. Short deck/pineapple keep the old ladder; PLO unchanged (pot).
- #9131: rule 2's premium limp->open now uses the same V74 draw
  (`HorseLogic.holdemPremiumOpenRaiseTo`); fixed 3bb only when V74 is off.
- Harness before -> after (exact 2.00bb share, median): cash 0.50/1 86.8%->0%,
  2.00->3.00; cash 1/2 39.4%->0%; cash 200bb median 2.80->3.40; MTT 60bb ante
  30.0%->20.0%, median 2.13->2.33; MTT 24bb ante 34.5%->1.3%.

### Phase C - Release / infrastructure (mixed)
| item | PR | merge | status |
|---|---|---|---|
| owner window V63-V69 :55 | #8917 | 53c5991113 | expired |
| scale gate reads docker absence | #8928 | 0db4b3de03 | merged |
| thaw no longer mutates retired clubs (freeze incident 2026-10-31 19:54:37-20:20:26, fn_thaw_platform 500 CLUB_RETIRED) | #8946 + migration 20261031201656 | ca54cf2d0c | **live (DB)**; normal thaws verified 23:00:18 Oct 31, 08:00:06 and 10:05:00 Nov 1 |
| close V63-V69 window | #8954 | 24e4211d90 | done |
| drained-boundary cutover for eed06fe5 (census cannot fit: V8 QueryObjects ~11-12 ms/MB, ~45 s at 3.85 GB vs 30.3 s allowance) + witness RPC `fn_ca_release_drained_predecessor_witness` (migration 20261031212432) | #8986 | 5b06a8a8b6 | merged; never succeeded (section 4) |
| owner window V63-V70 drained :55 | #9015 | 9dfb752f99 | expired 05:20 UTC 11-01 |
| drained witness errexit bug | #9095 | b6fd73bcd9 | merged |
| platform-health phase 6 (closed Diamond tables retire quietly, stall gauge, observe-only memory governor) | #9057 (other session) | ca8250444e | merged, not live |
| owner window crash-loop fix | #9106 (other session) | 3fafb01c8f | expired 09:25 UTC |
| deadlock analysis / decision | #9133 / #9134 (other session) | ac6ffa970a / 9c5dfec15a | docs merged; **decision not implemented** |
| census re-offered after a self-restart | #9148 | c47bd55d19 | merged |
| census scale gate: fixture reports own verdict at 33 s, cleanup uses full 5 s reserve with docker kill, at most two measurements per image | #9141 | 13dd622a1e | merged |
| daily preparation owned by a window (03:30-03:50 Chicago, first push or schedule run of the Chicago date), crons `31,35,39,43 8/9 * * *` | #9147 | 241d09027c | merged; first use 2026-11-02 03:30 CST (09:30 UTC) |
| door check carries a door a queued window migration supplies (daily route only; host re-verifies via new RPC `fn_ca_engine_release_missing_functions` migration `20261101134516` before seal) | #9149 | - | **CLOSED unmerged** after #9139 merged (branch `fix/doors-honor-queued-window-migrations` kept as an option) |
| door allowlist + owner windows 70/71 (14:30-20:25 UTC 11-01, contain `4e9c3228`; 71 installs 04247 then 05048 in the first confirmed freeze) | #9139 (other session) | b194c1db64 | **MERGED 14:30:30 UTC**: this session is today's release owner |
| DB-only window for 05048 | #9150 (other session) | - | OPEN |
| measurement kit + baselines | #9138 | 6340baecb5 | merged |

### Phase D - CI health fixes made along the way
- #9036 rake-share proof replays at its install clock (`scripts/ci/test-player-fee-redemption.sh`, `RAKE_SHARE_REPLAY_CLOCK`), merged `47f9db6acf`.
- #9037 (other) Stats fixture 30-day window; #9047 (other) pg_net built with `-DCURL_DISABLE_TYPECHECK`.
- Known flakes (re-run only after confirming another branch fails the same job):
  `scripts/ci/test-cash-failure-pgcron.py` "after-intake original scheduler
  status changed"; `scripts/ci/test-highlighted-level-clock.py` fixed TCP port
  55784 inside the ephemeral range ("pg_ctl: could not start server");
  transient curl 56; intermittent mainInspectorRetirement container test;
  `HorseLeagueProcessPriority.integration` under concurrent hooks.

---------------------------------------------------------------------------

## 4. THE BLOCKERS AND THE CRITICAL PATH TO "LIVE"

### Blocker 1 (hard, structural): eed06fe5 can never certify a cutover
Evidence (`public.engine_maintenance_break_log`, `engine_maintenance_break_faults`,
health): 2026-11-01 07:55 break unparked_at_countdown 98 / ready_for_restart_at
NULL; 10:00 break 5 / NULL (process 18 min old); 2026-10-31 22:55 99 but ready
at 22:56:36; 19:55 NULL. Over 4 days the certificate opened in 9 breaks (5-107 s
after countdown), never in 6; by ~40 s (what the drained route needs, 260000 ms
left) only twice. At 07:55 /health showed `{cards_in_air: 97,
stopped_bank_custody_unwritten: 1}` while no hand was actually committed in any
sampled break (zero `hand_history` commits after countdown).
Cause: ~117 tables hold hands frozen mid-play that eed06fe5 can never finish
(incomplete preflop `hand_state_snapshots` older than 30 min, `reserved`
permits, seated chips): 70 Midway SNG, 35 Midway MTT, 12 Diamond; ~73 froze
2026-10-29 06:00-06:06 (eed06fe5's first hands), others at its self-restarts;
99 belong to `tournament_abort_targets` of operation d44c4440 (87 of 89
tournaments `stop_requested`). eed06fe5 re-adopts them from
`tournaments.status = 'RUNNING'` after every restart (5 tables at 17 min, 97 at
67 min) and reports `cards_in_air`; plus ~90 closed Diamond Arena tables being
kill-rebuilt (~15k/h; Dan ruled 10-31 Diamond Arena stays closed).
Why the existing DB admission does not help: its allow-list admits only
`f06_preparation_unresolved/stuck`; `cards_in_air` and custody reasons are
excluded by law (`noServingReleaseBuysACustodyException.law.test.ts`,
`everyRestartBlockerDeclaresItsBound`), /health gives counts not identities,
and handsInFlightTotal is 0 by construction in a break.
Options (from #9133/#9134 and the certdiag analysis):
1. **DECIDED (#9134, owner-delegated): replace eed06fe5 at its next unplanned
   death.** Shape: (a) the transaction stages the candidate as today and writes
   a durable, expiring (e.g. 24 h) `crash-boundary` intent naming candidate SHA
   and image without touching the running engine; (b) `engine-supervisor.sh`,
   on an exit it did not cause, restores the candidate instead of the sealed
   predecessor when the intent is present/unexpired/image proves its source;
   (c) seal only after existing post-start proofs (exact identity locally and
   publicly, leader, natural committed hands), else rollback to predecessor
   seal; (d) planned stops / in-progress releases never consume the intent.
   Must ship with native host tests (`engine-drill.yml`), CLAUDE.md 10 rule 4.
   **NOT IMPLEMENTED YET.** It belongs to the release owner
   (platform-health session). If nobody owns it when you start, confirm on
   #9134/#9133 (comment) and then build it, carefully, as the single owner.
2. #9148's census route after a self-restart (heap ~1.5 GB fits) - only if a
   :55 break lands within ~35-40 min of a crash-restart AND the one-shot
   checkpoint actually retires the frozen originals (unproven).
3. Widen the certificate to admit database-witnessed frozen hands - rejected
   (would void real hands; overrides custody law). Needs Dan explicitly.

### Blocker 2: the queued window migrations and the door check
`20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql`
(#9054; `-- @install-window: daily-maintenance`; triggers on hand_history,
hand_state_snapshots, hand_atomic_commits, smarter_private.hand_continuations,
hand_submissions, f06_hand_dispatch) and `20261101004247` (#9073) are not in
`supabase_migrations.schema_migrations`. Every engine build from `0d7cd8df4e`
on fails "Prove The Exact Engine Has Every Production Door"
(`scripts/ci/check-engine-doors-exist.mjs`): `fn_ca_cancel_tournament_abort_unsettled_hand`
missing. Resolution: #9139 MERGED (14:30:30 UTC): the abort function is on the door
allowlist (its call is fail-closed) and owner window 71 installs 04247 then
05048 inside the first confirmed owner-window freeze. #9149 (ours) was closed
as redundant. #9150 (DB-only window) was still open at 14:36 UTC - check that
it does not double-install (the installer is idempotent: "queued" = not in
schema_migrations). Check with `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20261101004247','20261101005048');`.

### Blocker 3 (fixed, verify on first use): daily preparation punctuality
#9147 merged. Admission is judged by the run's own creation instant (schedule
`created_at` or push `repository.pushed_at`); runs outside 03:30-03:50
Chicago prepare nothing; inside it, the lowest run id of the Chicago date owns
the preparation and later runs print "belongs to earlier run N". Trade-off by
design: if the owning run fails, no later run takes over that day. Note: even
with #9147, on the daily route the receiver's door check (~03:50) runs BEFORE
the window installer (04:00 freeze), so builds needing 05048 still fail that
morning unless #9149 (carry) or #9139 (allowlist) lands; otherwise they ship
one day later, after the migration installs. First real test: 2026-11-02 03:30-03:50 America/Chicago
(09:30-09:50 UTC). Verify a stage run owns the preparation ("daily_preparation
== true"), dispatches exactly one receiver, and the window installer runs in
the 04:00 freeze (10:00 UTC).

### Blocker 4 (fixed, verify on first use): census scale gate
#9141 merged. First use: the next receiver on the host. Verify the receipt has
`attempts` and, on timeout, `freshRemeasurement`.

### Critical path (do in this order)
1. Read the latest state: health, the #9139 owner windows 70/71 (14:30-20:25 UTC
   2026-11-01: did a :55 attempt happen, did the migrations install, did the
   cutover refuse on the eed06fe5 certificate?), PR #9150, any crash-boundary
   PR, `engine_maintenance_break_log` since 14:30 UTC 2026-11-01, receivers
   (`gh api ".../actions/workflows/auto-deploy-hetzner.yml/runs?per_page=10"`).
2. Coordinate (PR comments) so exactly one owner drives: migration install
   (#9139 window 71, or #9150, or the daily installer) and the eed06fe5
   replacement (#9134 crash-boundary).
3. When a release activates: verify `releaseSha` contains `241d09027c` or later
   (all horse merges), thaw complete (`maintenance.active false`, break log
   thaw_ok true, tables_resumed), hands resumed (handsInFlightTotal > 0,
   committed hands in hand_history after activation), liveness ok, RSS trend.
4. Measure (section 6) for at least a few hours after activation; compare to
   baselines; report per workstream as LIVE only with evidence.

---------------------------------------------------------------------------

## 5. NOT DONE / FOLLOW-UPS (backlog, in priority order)
1. Everything in section 4 (release, verification, measurement).
2. Decide V67 strength after live data.
3. Owner decision: 16-22bb tournament "orange zone" shove ranges (not changed).
4. Squeeze response and 3-bet-response beyond V73's single-3-bet scope; heads-up
   defence; league heads-up blind posting; open-size league run (V74 harness only).
5. The old V7 4-bet-bluff band in `HorsePreflop.ts` still exists; rule 4a
   converts its sized 4-bets to calls at the final layer (intentional). A clean
   follow-up could retire the band at the source with a flag.
6. CI: fix `test-highlighted-level-clock.py` fixed port 55784 (use an ephemeral
   free port); the pgcron after-intake flake.
7. `stalledTableCount` jumps (18 -> 177 in 3 min) - investigate after release
   (#9057 changes the gauge).
8. eed06fe5 memory crash-loop is cured only by replacement (#9057 in main).

---------------------------------------------------------------------------

## 6. MEASUREMENT: BASELINES, TOOLS AND EXACT PROCEDURES
All in the repo since #9138: `scripts/horse-measure/` (README with every
baseline number) and `docs/horse-measure/` (reports, raw results, checkpoint
logs of 2026-10-30/31).
- Open sizes / facing 3-bet / facing 5-bet: `scripts/horse-measure/preflop-raise-ladder.sql`
  (one SELECT; change `interval '40 minutes'`). Baseline (40 min to ~01:58 UTC
  11-01, 8,668 NLH hands): cash opens 1,319 - 726 at <=2.05bb, median 2.00,
  mean 2.27; MTT 3,841 - 1,125 <=2.05, 1,230 at 2.05-2.3, 694 at 2.3-2.6, 300
  at 2.6-3.0, 137 at 3.0-3.6, 355 at 3.6+; facing 3-bet cash 141/33/22
  (fold/call/4-bet), MTT 602/149/100; facing 5-bet after 4-bet MTT call 8 / fold
  8 / jam 7, cash call 1 / jam 1. Against human 3-bets (72 h, has_human): NLH
  156/23/14; PLO5 493/180/45.
- RFI by position/stack: `scripts/horse-measure/horse-rfi-live.py plan SINCE UNTIL --out DIR`
  then `render`; baseline `docs/horse-measure/2026-10-31/horse-rfi-live-2026-10-31.md`.
- Postflop V63-V69 cells: `scripts/horse-measure/horse-v63-v69-measure.py`
  (`sql cash|mtt`, `fn-sql`, `telemetry-sql`, `render`); use a 24 h window
  starting after activation; `horse_hand_reviews` is the >=20bb subset only.
- Receipts to confirm present after release: `v70_gto_open`, `v71_ante_push`,
  `v72_defend_vs_opener`, `v73_vs3bet_defence`, `holdem_no_four_bet_bluff`,
  `holdem_premium_flat_deep_three_bet`, `holdem_four_bettor_continues`, plus
  the V61-V69 receipts (telemetry-sql in the measure script reads them).
- Expected direction: cash opens never < 2.5bb, mostly 2.5-3.5bb; MTT >25bb
  ~20% exact min-raise; opener fold to 3-bet ~52-57% late seats, ~28-45% early;
  no sized 4-bet with non-premiums; QQ/AK 4-bet-then-call where the price
  allows, flat deeper; no fold after own 4-bet at a callable price.
- Saturday Mystery style check: query preflop 3-bet/4-bet/5-bet sequences for a
  tournament with a human seated (the query that produced the reported-hand
  table is the `lvl`/`hot` CTE pattern in preflop-raise-ladder.sql, filtered by
  `tournament_id` and `has_human`), and `ca_hand_facts(hand_id,user_id,hand_class,position)`
  for the hand classes.

---------------------------------------------------------------------------

## 7. HOW TO VERIFY "LIVE" (exact commands)
```
curl -s https://engine.smarter.poker/health | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['releaseSha'],d['uptime'],d['maintenance']['active'],d['handsInFlightTotal'],d['liveness'])"
git merge-base --is-ancestor 241d09027c <releaseSha> && echo contains-all-horse-work
```
DB (SELECT): `SELECT * FROM public.engine_maintenance_break_log WHERE break_started_at > now() - interval '6 hours' ORDER BY 1;`
`SELECT count(*) FROM public.hand_history WHERE created_at > '<activation>'::timestamptz;`
Release records: `ca_engine_deploy_attempts` (door refusals were recorded there).

---------------------------------------------------------------------------

## 8. PITFALLS THAT COST TIME (do not repeat)
- Raise-level counting off by one: with `rb` = raises before the action, the
  open has rb 0, a 3-bet rb 1, a 4-bet rb 2, a 5-bet rb 3.
- 1-chip big blind tables round to whole chips: a "spread of sizes" test needs
  a cents table (e.g. 0.05/0.10).
- Rule ordering in HorseHoldemPremiumAggression: 4b -> rule 1 -> 4a -> rule 2
  (4a before rule 1 broke the KQo law).
- The worker receipt validator rejects new final-rule transitions unless
  whitelisted (`responseValidation.ts`); context-free receipts are validated by
  the journal (`phaseProof.ts`, `review.ts`), so admissions must work without
  context too.
- Hash pins in `server/src/benchmark/FeatureAblationQualificationPlans.json`
  are stale for HorseLogic/HorsePreflop and not enforced.
- Engine `totalHandsDealt` is not monotonic; `stalledTableCount` over-counts.
- A receiver that sits waiting can be cancelled by another session; never
  cancel yourself without Dan's explicit OK; never assume interference.
- Owner windows must end before the next daily window and be <= 6 h; the floor
  witness (`activation-floor.json`) selects exactly one window.
- PLO cash is where most human hands are (plo5/plo4); Dan's 4-bet report was NLH
  tournament (Saturday Mystery).

## 9. OPEN QUESTIONS FOR DAN (ask only if the owner path is unclear)
1. Who is the single release owner for today: the #9139 session (owner windows
   70/71, 14:30-20:25 UTC) or the platform-health session (#9134 crash-boundary)?
2. Approve implementing #9134 crash-boundary replacement if its owner is not
   already building it.
3. 16-22bb orange-zone shove policy.
