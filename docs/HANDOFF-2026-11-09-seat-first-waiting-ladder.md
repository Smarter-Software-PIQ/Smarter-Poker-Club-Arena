# HANDOFF: Seat-first waiting ladder and the under-300 board

**Status: MID-FLIGHT. Do not treat as finished.**
Written 2026-11-09 15:35Z (09:35 Chicago) by the seat-first lane,
session `01BbZPDjo3H8LEbvfUCrdZbM`.

This is a continuation document, not a summary. Everything below was verified
against the workspace, GitHub, the live engine, the published client or the
production database at the time stated. Items that were not verified are
labelled **UNVERIFIED** or **UNKNOWN, NEXT AGENT MUST INSPECT**.

---

## 1. EXECUTIVE CONTINUATION BRIEF

**What is being built.** Dan asked for automated Spin and Sit & Go volume to be
cut to **under 300 starts per America/Chicago day, combined**, by changing how
horses take seats rather than by slowing play or restricting human seating. The
room was running itself roughly 12,000 to 19,000 seat-first games a day to
produce a handful of games a person actually sat in.

**The product objective, in Dan's own words** (2026-11-08):

> "WE SHOULD ONLY HAVE ONE HORSE SITTING AT HAND FULL OF EVENTS, WE ARE AUTO
> RUNNING WAY TOO MANY. ... SIT ONE HORSE AT LIKE 11 DIFFERENT SPINS AND LIKE
> 6 SIT N GO'S. SPINS AND SIT N GO'S WAIT FOR HUMANS TO JOIN, AFTER 1 HOURS TO
> 1:20 MINUTES WITH NO HUMANS A SECOND HORSE SITS FOR SPINS, AND THEN WITHIN
> THE NEXT 30-60 MIN A 3RD HORSE WILL SIT TO PLAY, THE IDEA BEING THAT WE
> AREN'T JUST RUNNING ALL DAY EVERY DAY FOR NO REASON. FOR SIT N GOES, HORSE
> WAITS UP TO 4 HOURS FOR A HUMAN TO JOIN, ANYTIME AFTER 3 HOURS AND 4 HOURS A
> HORSE CAN JOIN TO PLAY, THEN A NEW HORSE WAITS AT A NEW SIT N GO AFTER THAT
> STARTS. IF A HUMAN JOINS ANY SIT N GO, IT STARTS. IF A HUMAN SITS AT AN EMPTY
> TABLE, OTHERS SHOULD JOIN THE SIT N GO WITHIN 3-7 MIN."

**Current phase.** All behaviour is BUILT and MERGED to `main`. The client half
is LIVE. The **engine half is not live**: the engine still serves the
pre-ladder build. Activation is owned by another lane and is currently stalled
inside an authorized window. Nothing can be accepted until it activates.

**The single most important thing to understand.** The acceptance criterion is
a **measured, complete Chicago day** on the activated engine. No day measured
so far qualifies: 2026-11-07 and 2026-11-08 are pre-change, and 2026-11-09 is a
split day (old engine for its first 15+ hours). **Do not report a partial day
as a day** - measured here: Nov 8 read mid-day was 18,633 and its closed figure
was 19,074.

**First action for the next agent.** Section 22. In short: read this file and
`CHECKPOINT-seat-first-waiting-ladder.md`, then check whether the engine has
been replaced (`curl https://engine.smarter.poker/health`). If `version` is
still `391f7bc0`, the cutover has NOT happened and the next agent's job is to
keep reading the release owner's record on PR #10063, not to dispatch anything.

---

## 2. USER REQUIREMENTS AND WORKING PREFERENCES

### Non-negotiable product requirements (Dan, locked)

| # | Requirement | State |
| --- | --- | --- |
| R1 | Under **300** combined Spin + regular Sit & Go starts per Chicago day | built, NOT yet measured on the new engine |
| R2 | **One** horse opens a board; **11** Spins and **6** regular Sit & Gos | built, not live |
| R3 | Spin ladder: 60-80 min to the 2nd horse, then 30-60 min to the 3rd | built, not live |
| R4 | Regular Sit & Go: horse waits up to 4 h; 2nd horse any time after 3 h | built, not live |
| R5 | A human who sits is joined **within 3-7 minutes** | built; client live, engine not |
| R6 | If a human joins any Sit & Go, it starts | pre-existing, preserved |
| R7 | Taken out of the horse auto-launch schedule | CLOSED |
| R8 | **Horses are refunded exactly as humans, 100% of the time** | CLOSED, verified + SQL law |

**R8, Dan's exact words, said four times:**

> "AND HORSES GET REFUNDED 100% OF THE TIME, SAVE THIS TO MEMORY AND ITS A HARD
> RULE, I DON'T KNOW WHO STARTED THIS, BUT HORSES GET REFUNDED EXACTLY THE SAME
> AS A HUMAN 100% OF THE TIME!"

### Corrections Dan issued during this work - all are locked

1. **3:00-3:30 was a departure from 3-7 minutes.** The engine drew the fill
   time from a 30-second spread above the 3-minute floor, so every fill landed
   in the first half-minute of the band. Dan rejected that. The spread is now
   the whole band. **Do not narrow it again.**
2. **An over-target day is never a pass.** An earlier draft of the checkpoint
   argued a day over 300 with many human-triggered starts was "the platform
   working, not the change failing". Dan rejected it. The split between
   human-triggered and horse-only is **for diagnosis after the verdict, never
   instead of it**.
3. **Contents must be checked independently of schema inventory.** A matching
   installed-migration set does not prove a build contains the behaviour, and
   commit ancestry does not either, because a later commit can revert the lines.
   **Read the tree.**
4. **Do not default to the 4 AM window.** Dan ordered an immediate cutover at
   13:48Z ("GET THEM LIVE NOW, DO NOT WAIT UNTIL 4AM, DO IT ASAP"). Attach to
   the authorized operation; never create a second one.
5. **Zero recent occurrences is not zero future exposure.** Applied to the
   satellite-feeder regression; the claim was withdrawn from the changelog.
6. **The pre-freeze and in-freeze snapshots may legitimately differ.** Hands,
   seating and cash-outs happen between them. Compare snapshots taken after
   **confirmed quiescence** and reconcile the rest through committed records.
7. **Capture the closed pre-change day separately from a partial-day baseline.**
8. **Derive the reporting date from the actual activation**, never name a day in
   advance.
9. **Keep scope tight.** Explicitly out of this assignment: an ownership-lookup
   script, release-workflow hardening, and a digest trend enhancement. They were
   proposed by this lane and Dan ruled them out of scope. **Do not build them.**

### Working preferences (from Dan's standing instructions)

- Operate as lead PM with autonomous execution authority; announce and execute;
  surface only genuinely irreversible decisions.
- **No unverified data.** Never fabricate analysis; never rely on stale dates.
- Report progress in **plain English**, not commit SHAs and jargon as the main
  content.
- Never ask Dan to do a job the agent can do, **including merging its own PRs
  and finishing delivery to live**.
- If Dan must say something to unblock the agent, end the reply with the exact
  line he should send back, word for word.
- Agent work trees belong on the external SSD, not the Mac's boot drive, and an
  agent deletes what it no longer needs when finished.

---

## 3. PROJECT AND REPOSITORY IDENTITY

| Field | Value | Confirmed |
| --- | --- | --- |
| Project | Smarter.Poker **Club Arena** | yes |
| GitHub repo | `Smarter-Software-PIQ/Smarter-Poker-Club-Arena` | yes |
| Repo note | owner renamed from `Smarter-Poker`; prefer the new owner path | yes |
| Working directory (this session) | `/home/claude/ca-fix` | yes |
| Worktree | yes; common git dir `/home/claude/ca-canonical/.git` | yes |
| Branch at handoff | `agent/seat-first-handoff-20261109` | yes |
| Feature branch (unmerged) | `agent/a-feeder-never-outlives-its-target` @ `6a8a67e50992` | yes |
| `origin/main` at handoff | `13cced18fd0948effb52cb33a141eb48359af253` | yes |
| Fetch refspec | only `main` and `agent/*` are mirrored locally | yes |
| Client stack | Vite + React 19 + TypeScript, React Router v7 | yes |
| Engine | Node/TypeScript on Hetzner, `server/src/index.ts` | yes |
| Database | Supabase Postgres, project `kuklfnapbkmacvwxktbh` | yes |
| Client origin | `https://ca-static.smarter.poker` | yes |
| Public route | `https://smarter.poker/hub/club-arena/*` (World Hub rewrite) | yes |
| Engine health | `https://engine.smarter.poker/health` | yes |

**Branch-naming trap (measured):** this clone's fetch refspec mirrors only
`main` and `agent/*`. A branch named `fix/...` gets **no local tracking ref**,
so the pre-push/stop hooks report "no remote branch" even when `git ls-remote`
proves the push landed. **Use `agent/...` branch names in this clone.**

---

## 4. REPOSITORY MAP (only what matters to this work)

### Engine, production code - EDIT WITH CARE

| Path | What it is | Modified by this lane |
| --- | --- | --- |
| `server/src/config/seatFirstLadder.ts` | **The ladder.** Rung constants, `ladderForSeats`, `openingRungMs`, `nextRungMs`, `humanArrivalMs`, and the new feeder helpers | YES, created + extended |
| `server/src/services/TournamentRecurringService.ts` | The launcher. Board counting (`seatFirstBoardRoom`), board creation, `createSatelliteHeadsUp`, the human partner-hold constants and arithmetic | YES |
| `server/src/GameServer.ts` | One-rung top-up (`fillPartialSeatFirstGame`), `advanceSeatFirstRung`, and the new `seatFirstNextWaitMs` | YES |
| `src/utils/seatFirstPartnerHold.ts` | **Client mirror** of the hold: constants, `seatFirstPartnerHoldEndsAtMs`, the clock and the "Deals In m:ss At The Latest" string | YES |

### Tests

| Path | Covers | Modified |
| --- | --- | --- |
| `server/src/services/theSeatFirstBoardWaitsForAPerson.law.test.ts` | the ladder law; 27 cases incl. the feeder-exclusion pin | YES |
| `server/src/services/aHumansOpponentSeatIsKeptForPeople.test.ts` | the partner hold; 23 cases | YES |
| `server/src/config/aFeederNeverOutlivesItsTarget.test.ts` | the feeder bound; **8 cases** | YES, created |
| `tests/unit/seatFirstPartnerHold.test.ts` | the client mirror | YES |

### Migrations (all on `main`, all installed in production - verified)

| Version | Name | Purpose |
| --- | --- | --- |
| `20261108215333` | `horses_are_refunded_exactly_as_humans` | the SQL law refusing horse status as a reason not to pay |
| `20261109010200` | `seat_first_daily_starts_report` | `fn_ca_seat_first_daily_starts(day)` - the acceptance number |
| `20261109022243` | `seat_first_daily_starts_fits_the_rest_budget` | the same function rewritten to run inside service_role's ~8 s timeout |
| `20261109022418` | `tournaments_started_at_has_an_index` | `idx_tournaments_started_at`, built CONCURRENTLY |

### Documentation produced by this lane (all merged to `main`)

| Path | Purpose |
| --- | --- |
| `CHECKPOINT-seat-first-waiting-ladder.md` | **THE single checkpoint for this lane.** Opens with `SCOPE OF RECORD (2026-11-09)` |
| `docs/changelog/2026-11-09-the-under-300-number-fits-the-rest-budget.md` | the reporting function and its two performance causes |
| `docs/changelog/2026-11-09-the-human-window-is-the-whole-three-to-seven.md` | the 3-7 correction |
| `docs/changelog/2026-11-09-the-daily-selection-could-not-read-its-own-helper.md` | the blocked 03:30 selection incident |
| `docs/changelog/2026-11-09-a-feeder-never-outlives-its-target.md` | the feeder regression (on the unmerged branch) |
| `docs/changelog/evidence/2026-11-09-feeder-priority/` | SQL fixtures and traces from the feeder work |

### Scripts this lane wrote - IN THE SSD ARCHIVE, NOT THE REPO

`/Volumes/SmarterArchives 1/agent-evidence/seat-first-ladder-01BbZPDj-20261109/`

| File | Purpose |
| --- | --- |
| `acceptance-evidence.md` | every measurement with its read time |
| `check-candidate-contents.sh <sha>` | reads a build's TREE for all three behaviours. **exit 0 present, 1 missing, 3 could not tell** |
| `verify-cutover.sh [sha]` | the post-cutover checks from the runbook, read-only |
| `occupied-snapshot.sql` | per-game player/seat/stack digest |
| `cert-watch.log` | certificate and engine readings through the night |
| `SHA256SUMS.txt` | written before transfer, verified after |

**The archive path trap:** the real volume is mounted at
`/Volumes/SmarterArchives 1/` (note the space and the `1`). A stale root-owned
directory occupies `/Volumes/SmarterArchives`, which is read-only and contains
only symlinks; a write there fails with "macOS denied access" and is lost.

---

## 5. APPLICABLE INSTRUCTIONS AND CONSTRAINTS

Read before editing anything:

- `CLAUDE.md` (repo root) - the governing file. Sections that bind this work:
  - **1.1 / 1.4** delivery route and what "deployed" may be claimed
  - **2** production DDL policy: one migration = one transaction; no DDL probes
  - **2 rule 11** a migration reaches production only from protected `main`
  - **4** fix-first
  - **8** never push a red test; update a pin in the same commit as the behaviour
  - **10.5** **HORSES ARE PLAYERS.** Identical treatment, including TIMING
  - **10.8** laws live in `docs/laws.d/`; cross-lane asks via `COORDINATION-INBOX.md`
  - **10.9** the agent decides money with a clear path, five conditions
  - **10.11 / 10.12** fix at the root; **a repair job or detector is never the fix**
  - **10.85** **never create a Claude scheduled task**
  - **10.86** "I could not tell" is its own outcome; never coerce an unreadable
    answer into an empty one; a guard must have a named reader; a fix that
    leaves the same trap one level up has not landed
  - **11.5** never spend real chips to test a rule; probe in a rolled-back
    transaction; over the Supabase MCP one call is one transaction
  - **13** daily engine maintenance, the freeze invariants
- `PUBLISHING.md` - push, protected merge, publication, live proof
- `docs/ENGINE-RELEASE-RUNBOOK.md` - section 4.8 is the post-cutover checklist
- `AGENTS.md`, `AGENT-PLAYBOOK.md`, `docs/agent-policy/REFERENCE-INDEX.md`

**Conflict resolved during this work:** CLAUDE.md section 13 said the next
activation is the 04:00 window. Dan's 13:48Z order supersedes it for this one
operation. The section itself was not edited; the override lives in the owner's
comment on PR #10063.

---

## 6. COMPLETE DISCOVERY RECORD

### 6.1 How a seat-first board works

- A board is "seat-first" when `variant === 'spin'` **or** `max_players <= 2`.
- `start_time` is **not a schedule**. It is the instant the fill lane treats the
  board as fillable. Writing a future `start_time` IS how a board waits.
- `GameServer.fillPartialSeatFirstGame` tops a board up by **one rung**:
  `const target = hasHuman ? seats : Math.min(seats, paid + 1)`.
- The gate `if (!hasHuman && !windowClosed) return;` means **a seated person is
  served regardless of how far away the board's own window is.**
- The enumerator requires `paid > 0`: a board with nothing paid is never
  topped up.
- `advanceSeatFirstRung` writes the next rung into `start_time` after a rung is
  climbed. A failed write leaves the old, already-passed window, so the board
  is re-asked on the next backoff. **Late is survivable; early is not.**

### 6.2 The two satellite-feeder shapes (measured in production)

| Shape | Columns | Count in 10 days |
| --- | --- | --- |
| rare | `tournament_type='SATELLITE'`, from `createSatelliteHeadsUp` | 11 |
| common | `tournament_type='SNG'` + `satellite_target_id` set, 6-max/9-max | 1,111 |

This matters because the ORIGINAL board count matched `variant='sng'` and
`tournament_type='SNG'` with no satellite constraint. Measured live at 05:42Z on
2026-11-09: **53 feeder boards** were sitting in `REGISTERING` carrying exactly
that shape. Against a cap of 6, the count would have read 85 and **never opened
another heads-up board again.** That is why `ad998fc9` exists.

### 6.3 The human partner hold

- Engine: `seatFirstHumanPartnerHoldUntilMs(startTimeMs, firstHumanSeatedAtMs,
  jitterMs, createdAtMs)`.
- Pre-ladder it returned `min(ceiling, max(windowEnd, partnerFloor) + spread)` -
  the LATER of the board's window and the floor. With an hours-away ladder
  window that would have made the one person who actually sat wait out the
  entire horse ladder. It now returns `min(ceiling, partnerFloor + spread)`:
  **counted from the moment they sat, and the board's own window no longer
  enters into it.**
- The deadline is anchored to `table_seats.joined_at`, a durable column.
  Measured: **549 of 549** live seat-first seats had a non-null `joined_at`, so
  the degenerate "seat time unknown" branch is not exercised in practice.

### 6.4 The client/engine compatibility proof

The client shipped ahead of the engine. The promise on screen is "Deals In
m:ss **At The Latest**", so the engine must never act LATER than the countdown:

```
serving engine (391f7bc0)  min(seated + 350s, max(windowEnd, seated + 90s) + 30s)
new engine                 min(seated + 420s, seated + 180s + jitter)
client countdown           seated + 420s
```

Both engines act at or before `seated + 420s`, so the promise holds on both
sides of the cutover. The only visible effect is a board dealing EARLIER than
promised, which the client's own header already allows.

### 6.5 The reporting function, and why it was rewritten

`fn_ca_seat_first_daily_starts(day)` returns
`(stat_day, kind, starts, human_triggered, horse_only)` where `kind` is
`'Spin'`, `'regular heads-up'` or `'satellite feeder'`.

The first version worked over the Supabase MCP (postgres, 5-min timeout) and
**500'd over PostgREST** as `service_role` (~8 s timeout). Two causes:

1. `(t.started_at AT TIME ZONE 'America/Chicago')::date = day` is not sargable,
   so the expression ran for all 991,799 rows of a 1,541 MB table. Replaced
   with one half-open `timestamptz` range served by `idx_tournaments_started_at`:
   full heap scan -> 12,521-row index range read in 66 ms.
2. The bigger one: the SEAT side. A `LEFT JOIN tournament_players` +
   `bool_or(...)` made the planner hash-join the WHOLE of
   `tournament_players` - 3,080,845 rows, 713,772 buffers, **13,224 ms of the
   13,861 ms total**. A plain `EXISTS` was not enough either (2,088 ms, two
   full scans). Fixed with `LEFT JOIN LATERAL (... LIMIT 1)`: **296 ms**.

**Lesson (CLAUDE.md 10.86 rule 4):** fixing only the day filter would have left
the real cost untouched.

### 6.6 The equal-refund verification

Behavioural, not code-reading: **390 of 390** horse entries in cancelled events
refunded; **9,400.00 debited and 9,400.00 returned, to the chip.** The SQL law
`20261108215333` now refuses horse status as a reason not to pay, enforced in
SQL where the TypeScript gate never looked.

### 6.7 The double-seat guard lives in the database

`fn_seat_horse_in_seat_first_game` takes
`fn_ca_lock_tournament_seat_acquisition(tournament, NULL, user)` and then
refuses a second purchase for a user already holding a `tournament_players` row
or a live seat. **Concurrency is enforced in Postgres, not in engine memory.**

### 6.8 The satellite-feeder regression this lane INTRODUCED

Found by this lane in its own change.

- A heads-up feeder is two seats, so `ladderForSeats` called it a regular
  Heads-Up and handed it the **3-to-4-hour rung**. Pre-ladder,
  `createSatelliteHeadsUp` used `seatFirstHumanWindowMs()` = 90-350 s.
- Two reasons that is wrong, not merely slow:
  1. the rung paces the 11 and 6, and `seatFirstBoardRoom` **deliberately
     excludes** every row with a satellite target from that count, so a feeder
     was paced by an economy it is not part of - the change disagreeing with
     itself;
  2. a feeder sold a seat in ONE event. Waiting hours lets the target start
     first. And the existing authority
     `fn_ca_expire_empty_fixed_sng_satellite` **cannot** clean that up: it takes
     an **EMPTY** `REGISTERING` feeder only (`current_players = 0`, no
     `tournament_players`, no live seats), and the opening horse means a feeder
     is **never empty after creation**, so it answers
     `not_empty_registering` and leaves the row.
- **Existing eligibility values reused rather than invented:**
  `SATELLITE_HU_TARGET_LEAD_MS = 30 * 60 * 1000` (the lead this format already
  requires) and `SATELLITE_MTT_TARGET_LEAD_MS = 3 h` (the scheduled branch's
  lead, already applied by the caller as a target filter).
- Measured exposure: **zero** heads-up satellite feeders created in the ten days
  to 2026-11-09. That is a reason not to hold a release, **not** evidence of
  zero future exposure.

### 6.9 Why Chicago 2026-11-09 has no 03:30 engine selection

Not this lane's defect, but it moved the acceptance day and is recorded here.

The 03:30 preparation (Stage run `42562159686`) waited its full five hours
(04:30:04Z -> 09:30:05Z) and then froze:

```
outcome             blocked
targetSha           null
deferredCandidates  []          <- the proof no candidate was judged
reason              [Errno 2] No such file or directory:
                    '.../server/standby/schema-evidence.py'
```

Cause: the selection job checks out **sparsely** (`scripts/ci`,
`server/scripts`), and `server/scripts/engine-release-installed-migrations.py`
line 84 loads `server/standby/schema-evidence.py` from the **working tree**.
`server/standby` was not in the list. The dependency arrived with **#10114**
(not #10113, which only added the script). Fixed on `main` by **#10157** with
`tests/a-sparse-checkout-holds-what-its-scripts-load.law.test.ts`.

**Four lanes opened a fix for this within seven minutes** (#10154, #10155 this
lane, #10156, #10157). Only #10157 merged. **Lesson: finding a defect in
another lane's file is a report, not an assignment.**

---

## 7. WORK COMPLETED DURING THIS CHAT

### Workstream A - the ladder (MERGED, squash `744549f3791c`, PR #10094)

- Created `server/src/config/seatFirstLadder.ts`: `SEAT_FIRST_OPENING_HORSES=1`,
  `SPIN_LADDER=[{60,80},{30,60}] min`, `SNG_LADDER=[{180,240}] min`,
  `HUMAN_ARRIVAL_MIN_MS=3 min`, `HUMAN_ARRIVAL_MAX_MS=7 min`,
  `ladderForSeats`, `openingRungMs`, `nextRungMs`, `humanArrivalMs`.
- Board targets narrowed to 11 Spins and 6 regular Sit & Gos, platform-wide.
- The human branch of the partner hold stopped waiting out the board window.
- Law test `theSeatFirstBoardWaitsForAPerson.law.test.ts`.
- Verified: merged, on `main`, in every candidate build in play.

### Workstream B - the satellite-feeder exclusion (MERGED, `ad998fc9a693`)

- `seatFirstBoardRoom` now also requires `.is('satellite_target_id', null)` and
  `.is('satellite_target', null)`, matching the predicate the report uses, so
  the engine and the report cannot disagree about what the six are.
- A first attempt that only added `.eq('tournament_type','SNG')` was
  **insufficient** - it missed the common 6-max/9-max feeder shape. Found by
  querying production rather than trusting the code comment.

### Workstream C - the 3-to-7 minute correction (MERGED, `9aac3926bae3`, PR #10136)

- `SEAT_FIRST_HUMAN_PARTNER_HOLD_SPREAD_MS` changed from `30_000` to
  `WINDOW_MAX - WINDOW_MIN` (240 s), and the client mirror likewise.
- Two engine tests that assumed "the hold is over" at times now inside the band
  were made **ceiling-relative** rather than weakened.
- Client mirror `src/utils/seatFirstPartnerHold.ts`: ceiling 420 000, so the
  table reads "Deals In 7:00 At The Latest".
- **Proven in the published bytes**, not the source tree: the live chunk carries
  `const Wl=24e4` and `Math.min(t+42e4, t+18e4+Wl)`.

### Workstream D - the acceptance number (MERGED, `20261109010200`, `...022243`, `...022418`)

- `fn_ca_seat_first_daily_starts(day)` and `idx_tournaments_started_at`.
- `estate-digest.mjs` section 6 now carries PostgREST's body in its error path
  instead of a bare status.
- Verified installed in production: all three.

### Workstream E - equal refunds (CLOSED, `20261108215333`)

- Behavioural verification 390/390, 9,400.00 in and back.
- SQL law `a-horse-is-never-the-reason-a-player-is-not-paid`.

### Workstream F - the feeder regression (**NOT MERGED**, PR #10181)

Branch `agent/a-feeder-never-outlives-its-target` @ `6a8a67e50992`, three commits:

1. `6dca2b9e69` the fix + 7 tests + changelog
2. `1b4c2a6c41` the custody branch + the 8th test + the exposure correction
3. `6a8a67e509` the changelog test count

What it does:

```ts
// server/src/config/seatFirstLadder.ts
FEEDER_OPENING_MIN_MS = 90_000
FEEDER_OPENING_MAX_MS = 350_000
feederOpeningMs(rand)
feederWaitMs(nowMs, targetStartMs, requiredLeadMs, rand): number | null
//   available = targetStartMs - requiredLeadMs - nowMs
//   available <= 0            -> null   (do not open, do not keep waiting)
//   non-finite now/target/lead -> null  (not knowing is not permission)
//   otherwise                  -> min(90-350s draw, available)
```

- `createSatelliteHeadsUp` uses it with `SATELLITE_HU_TARGET_LEAD_MS`; `null`
  means **no feeder is created** (`{tournamentId: null, registered: 0,
  created: false}`).
- `SatelliteHeadsUpConfig` gained `targetStartMs`, filled from
  `target.start_time` in `satelliteHeadsUpConfigFor`.
- `GameServer.seatFirstNextWaitMs(tournamentId, seats, paidNow)` is new and
  replaces the direct `nextRungMs` call in `advanceSeatFirstRung`. It reads the
  row's satellite columns (two attempts), then the target's `start_time`, and:
  - not a feeder -> the ladder rung;
  - feeder with room -> the bounded short window;
  - feeder undeliverable **and `paidNow > 0`** -> **`0`, deal now**, so the
    existing satellite settlement authorities resolve custody. **No new
    cancellation, refund or repair path** (CLAUDE.md 10.12);
  - feeder undeliverable and nothing paid -> `null`, left for
    `fn_ca_expire_empty_fixed_sng_satellite`;
  - **feeder check unreadable -> the LADDER rung, reported out loud.** Stated
    trade-off: a mis-paced feeder is a rare row, while a regular board that
    loses its rung is re-asked every twelve seconds and re-inflates the volume
    the ladder was built to cut.

### Workstream G - documentation and scope (MERGED)

- `0a9e8b1a798a` (PR #10146) the evidence-archive section.
- `5eafe23535fd` (PR #10159) the blocked-selection incident record.
- `1a4cf1771769` (PR #10178) **`SCOPE OF RECORD`**, superseding the two later
  "Still open" tables, which stay as history.

### Workstream H - cross-lane handoffs (no code)

Four entries appended to
`/Volumes/SmarterArchives 1/agent-evidence/COORDINATION-INBOX.md` (append-only;
each append verified byte-identical in its prefix):

| Time | To | Subject | ACK |
| --- | --- | --- | --- |
| 06:27Z | Kings Club downline lane + release owner | migration `20261109040704` in production, not on `main` | **open** |
| 06:27Z | release owner | candidate CONTENTS verdict | superseded by events |
| 10:43Z | BBJ sweep lane + production-integrity owner | nine workflows red at their latest `main` run, and the audit meant to raise that issue is one of them | **partial**: the tournament-lobby lane accepted the rematch-certification red as theirs |
| 14:57Z | all five | this lane has reset scope; nothing of theirs waits on it | n/a |

Plus three comments on PR #10063 to the release owner: the inclusion verdict
(`6743251834`), and the #10181 merge-hold question (`6743732886`).

---

## 8. VISUAL AND PRODUCT DECISIONS

No artwork changed. The only player-visible strings are in
`src/utils/seatFirstPartnerHold.ts` and they are **locked**:

| Element | Exact text | Note |
| --- | --- | --- |
| footer, 1 open seat | `Seat Reserved, Holding The Other Seat For A Player` | title case per CLAUDE.md 5.7 |
| footer, >1 open seat | `Seat Reserved, Holding ${openSeats} Seats For Other Players` | |
| status line | `Deals In ${m:ss} At The Latest` | counts to `seated + 420 s` |

- No em dashes anywhere in popup/toast copy (CLAUDE.md 10.7 - "em bars" means
  the character U+2014, and it is a COPY rule, never about artwork).
- The clock rounds **up** so it never reads `0:00` while waiting.
- **The AI-opponent disclosure is untouched and must stay so.** It lives in
  `src/components/legal/aiOpponentsDisclosure.ts`, is pinned by
  `tests/ai-opponents-are-disclosed.law.test.tsx`, and is surfaced in the TOS
  modal, the TOS page and `AuthPage`. Verified: **none** of this lane's three
  commits touches it or any surface carrying it. Its text already covers the
  ladder's long waits: AI opponents "Join Waiting Lists, Move Between Games And
  Keep Regular Hours".

---

## 9. FUNCTIONAL AND ARCHITECTURAL DECISIONS

| Decision | State |
| --- | --- |
| One horse opens every seat-first board, whatever the seat count | implemented, not live |
| 11 Spins and 6 regular Sit & Gos, **platform-wide**, not per club or price point | implemented, not live |
| Spin rungs 60-80 then 30-60 min; heads-up rung 180-240 min; randomised per board so the room does not tick over in lockstep | implemented, not live |
| A person who sits is joined in 3-7 min, counted **from their seat**, never from the board window | implemented; client live |
| Satellite feeders are excluded from the 11/6 count by the same predicate the report uses | implemented, not live |
| **Satellite feeders do not climb the ladder at all**; bounded by their target's clock | implemented, **not merged** (#10181) |
| Horses are refunded exactly as humans | implemented and live (SQL) |
| Nothing counts games played; nothing refuses a launch. "JUST HAVE AND LAUNCH FEWER GAMES" | architectural, honoured |
| Concurrency enforced in Postgres, not engine memory | pre-existing, verified |
| Boards already at `seats-1` deal once after activation; boards with nothing paid are **parked, not recycled** (`20261108034940`) | pre-existing, relied upon |
| No Claude scheduled task was created for any of this (10.85) | honoured |

---

## 10. EXACT CURRENT STATE (verified 2026-11-09 15:30-15:35Z)

### Live engine - **STILL THE PRE-LADDER BUILD**

```
releaseSha   391f7bc0d57c71637bd4af5181f70520661e3593
version      391f7bc0
instanceId   1-a22c325d   (leader; unchanged all day, so it never restarted)
maintenance  phase=idle  active=False  schedule 04:00 America/Chicago
handsInWindow 852   dealableTables 98   stalled 0
```

### Live client - **CARRIES ALL THREE BEHAVIOURS**

```
ca_sha   e366fab1398cd9d10f0b11228d41329c7a54b1ea
built_at 2026-11-09T15:21:57Z   run 42643234411
same value at ca-static.smarter.poker and smarter.poker/hub/club-arena
contains 744549f379, ad998fc9, 9aac3926  (verified)
```

### Git

```
branch        agent/seat-first-handoff-20261109  (this handoff)
feature       agent/a-feeder-never-outlives-its-target @ 6a8a67e50992 (pushed, PR #10181 open)
origin/main   13cced18fd0948effb52cb33a141eb48359af253
git status    clean (no staged, unstaged or untracked files)
```

### Certification

```
newest certified main commit   7b7e156427cf   success 2026-11-09T15:27:10Z
contents verdict on it         ALL THREE PRESENT (exit 0)
```

### Database

```
installed migrations   6994
20261109132114         NOT installed   <- this is what blocks the release candidate
20261109040704         installed (the Kings Club row that is not on main)
this lane's four       all installed
```

### Background processes started by this session (they die with the session)

| id | What |
| --- | --- |
| `b5rc93g0z` | ASAP cutover watcher; exits on a serving-SHA, instance or phase change; asserts it can read health |
| `bc4dz9hid` | PR #10181 poller; re-reads the PR's **current head** every pass |

### Measured counts

| Chicago day | Spin | regular HU | combined | human-triggered | feeders |
| --- | --- | --- | --- | --- | --- |
| 2026-11-06 | 4,859 | 4,860 | 9,719 | 1 | 4 |
| 2026-11-07 (closed) | 6,670 | 5,847 | **12,517** | 1 | 4 |
| 2026-11-08 (closed) | 11,369 | 7,705 | **19,074** | 5 | 4 |
| 2026-11-09 at 15:01Z (partial, split day) | 1,556 | 1,393 | 2,949 | 6 | 2 |

Census at 15:01Z: 78 Spin boards, 56 heads-up boards, 91 feeders in
`REGISTERING`/`RUNNING`.
Pre-freeze occupied snapshot at 15:13Z: **71 running games, 160 seats,
98,000.00 chips, fleet digest `83768267d6b2e6a9f80ba7ab938de9d3`.**

---

## 11. CHANGED-FILE LEDGER

| File | Status | Purpose | What changed | Verified | Committed |
| --- | --- | --- | --- | --- | --- |
| `server/src/config/seatFirstLadder.ts` | modified | the ladder | rungs, opening horses, human band; **then** feeder constants, `feederOpeningMs`, `feederWaitMs` | tests + tsc | ladder MERGED; feeder on branch |
| `server/src/services/TournamentRecurringService.ts` | modified | launcher | board targets; feeder exclusion in the count; spread widened; **then** `targetStartMs` on the config and the bounded feeder window | tests + tsc | first three MERGED; feeder on branch |
| `server/src/GameServer.ts` | modified | engine | one-rung top-up; **then** `seatFirstNextWaitMs` + the custody branch | tsc clean | on branch |
| `src/utils/seatFirstPartnerHold.ts` | modified | client mirror | ceiling 420 000, spread = whole band | unit tests + live bytes | MERGED + LIVE |
| `server/src/config/aFeederNeverOutlivesItsTarget.test.ts` | **new** | 8 feeder cases | created | 8/8 pass | on branch |
| `server/src/services/theSeatFirstBoardWaitsForAPerson.law.test.ts` | modified | ladder law | 27 cases incl. both `.is(...)` pins | 27/27 | MERGED |
| `server/src/services/aHumansOpponentSeatIsKeptForPeople.test.ts` | modified | partner hold | spread 240 000; band ends reached across 200 ids; two cases made ceiling-relative | 23/23 | MERGED |
| `tests/unit/seatFirstPartnerHold.test.ts` | modified | client mirror | countdown 420 000 | pass | MERGED |
| `supabase/migrations/20261108215333_*.sql` | new | refund law | created | installed | MERGED |
| `supabase/migrations/20261109010200_*.sql` | new | report fn | created | installed | MERGED |
| `supabase/migrations/20261109022243_*.sql` | new | report fn rewritten | LATERAL+LIMIT 1, sargable range | installed; 296 ms | MERGED |
| `supabase/migrations/20261109022418_*.sql` | new | index | `CREATE INDEX CONCURRENTLY` before `BEGIN` | installed, `indisvalid` | MERGED |
| `.github/scripts/estate-digest.mjs` | modified | digest | error path carries PostgREST's body | n/a | MERGED |
| `CHECKPOINT-seat-first-waiting-ladder.md` | modified | the one checkpoint | four passes + `SCOPE OF RECORD` | n/a | MERGED |
| `docs/changelog/2026-11-09-a-feeder-never-outlives-its-target.md` | new | feeder record | created | n/a | on branch |
| `docs/changelog/2026-11-09-the-daily-selection-could-not-read-its-own-helper.md` | new | incident | created | n/a | MERGED |
| `docs/HANDOFF-2026-11-09-seat-first-waiting-ladder.md` | **new** | this file | created | n/a | this branch |

**No unrelated user changes were present in the worktree at any point.**

---

## 12. ASSET LEDGER

No images, icons or art. The assets are evidence files.

| Asset | Path | Purpose | Approved | Implemented | Tracked |
| --- | --- | --- | --- | --- | --- |
| `acceptance-evidence.md` | SSD archive folder | every measurement with its read time | n/a | n/a | SSD only, checksummed |
| `check-candidate-contents.sh` | SSD archive folder | tree-level contents check | n/a | yes | SSD only |
| `verify-cutover.sh` | SSD archive folder | runbook 4.8 checks | n/a | yes | SSD only |
| `occupied-snapshot.sql` | SSD archive folder | seat/stack digest | n/a | yes | SSD only |
| `cert-watch.log` | SSD archive folder | overnight readings | n/a | n/a | SSD only |
| `SHA256SUMS.txt` | SSD archive folder | written pre-transfer, verified post | n/a | n/a | SSD only |
| scratch scripts | `/tmp/claude-0/.../scratchpad/` | watchers, pollers, selection reader | n/a | yes | **EPHEMERAL - dies with the session** |

**RISK:** the scratchpad copies vanish with this session. The six archived files
are the durable copies and their checksums were verified **on the device** after
transfer (tarball sha256 matched end to end). Anything else in the scratchpad
should be treated as lost.

---

## 13. COMMANDS AND TOOLS USED

| Command | Dir | Purpose | Result | Changes files | Rerun? |
| --- | --- | --- | --- | --- | --- |
| `bash scripts/agent-push.sh` | repo | the ONLY sanctioned push | VERIFIED each time | no | yes, always use it |
| `NODE_OPTIONS="--max-old-space-size=7168" npx tsc --noEmit` | `server/` | engine typecheck | exit 0 | no | yes |
| `npx vitest run <file>` | `server/` | engine tests (**server has its own vitest config**) | pass | no | yes |
| `npx vitest run tests/...` | repo root | client tests (root config includes only `tests/**`) | pass | no | yes |
| `gh api .../pulls --input <json>` | repo | open a PR (**`gh pr create` fails: GraphQL is blocked**) | works | no | yes |
| `gh api --method PUT .../pulls/N/merge -f merge_method=squash` | repo | protected squash merge | works with the ambient token | no | yes |
| `check-candidate-contents.sh <sha>` | repo | contents verdict | 0/1/3 | no | yes |
| `mcp__Supabase__execute_sql` | n/a | read-only production reads | works | no | yes |
| `mcp__remote-devices__counselors__host_terminal` | Mac | the only way to write the SSD archive | works | yes | yes |

**Traps measured:**

- `npx tsc --noEmit -p server/tsconfig.json` from the repo root **OOMs**. Run it
  from `server/` with `--max-old-space-size=7168`.
- `gh pr create` and `gh search prs` return **HTTP 403: GitHub GraphQL is not
  available from Claude Code sessions.** Use the REST API.
- In this cloud container `gh` has **no login of its own**; the ambient
  `GH_TOKEN` is the only identity, so `env -u GH_TOKEN gh ...` fails. (On Dan's
  Mac the opposite is true - see `CLAUDE.md` section 11.)
- A branch push often **auto-creates the PR** via the autopilot bot within
  ~60 s. Check before creating, or expect HTTP 422.
- The Supabase artifact/`?name=` filter: `GET /actions/artifacts?name=<exact>`
  works and returns `total_count`; paging 100 and filtering client-side **failed
  silently** in this session.

---

## 14. VERIFICATION AND TEST RESULTS

| Verification | Method | Result | When | Follow-up |
| --- | --- | --- | --- | --- |
| Ladder law | `vitest run server/src/services/theSeatFirstBoardWaitsForAPerson.law.test.ts` | **27/27 pass** | 2026-11-09 | - |
| Partner hold | `vitest run .../aHumansOpponentSeatIsKeptForPeople.test.ts` | **23/23 pass** | 2026-11-09 | - |
| Feeder bound | `vitest run server/src/config/aFeederNeverOutlivesItsTarget.test.ts` | **8/8 pass** | 2026-11-09 | - |
| Feeder check can FAIL | ran the suite with the workflow change stashed | **failed, naming the exact missing file** | 2026-11-09 | - |
| Config + seat-first suites | `vitest run src/config ...` | **173/173 pass (14 files)** | 2026-11-09 | - |
| Satellite suites | `vitest run src/services/FixedSngSatelliteBoard.test.ts ...` | **10/10 pass (3 files)** | 2026-11-09 | - |
| Engine typecheck | `tsc --noEmit` in `server/` | **exit 0** | 2026-11-09 | - |
| Contents check vs the serving engine | `check-candidate-contents.sh 391f7bc0...` | **exit 3, could not tell** (the ladder file does not exist in that tree) - correct | 2026-11-09 | - |
| Contents check vs certified builds | same script | `af9ea7bc2d` and `045886dd3c` **exit 1, missing the 3-7 window**; `15303e5799`, `823501480a`, `3c9404ab12`, `8d5aeb7bdbf9`, `7b7e156427cf`, `39a78e7b0bab` **exit 0** | 2026-11-09 | re-run on the SERVING sha after activation |
| Client bytes carry the window | fetched `TablePage-COrtaeNg-v6.js` from the live origin | `const Wl=24e4`, `Math.min(t+42e4,t+18e4+Wl)` | 2026-11-09 | - |
| Equal refunds | production SQL over cancelled events | **390/390; 9,400.00 in, 9,400.00 back** | 2026-11-08 | - |
| Report fn timing | `EXPLAIN ANALYZE` | 13,861 ms -> **296 ms** | 2026-11-09 | - |
| `joined_at` non-null | production SQL | **549/549 live seat-first seats** | 2026-11-09 | - |
| Feeder exposure | production SQL, 10-day window | **0 heads-up satellite feeders** | 2026-11-09 | re-check before relying on it |
| PR #10146 | GitHub checks | **24 checks, 0 failures, merged** `0a9e8b1a798a` | 2026-11-09 | - |
| PR #10159 | GitHub checks | **26 checks, 0 failures, merged** `5eafe23535fd` | 2026-11-09 | - |
| PR #10178 | GitHub checks | **clean, merged** `1a4cf1771769` | 2026-11-09 | - |
| PR #10181 | GitHub checks on head `6a8a67e509` | **43 checks, 0 failures, 20 running** at 15:28Z | 2026-11-09 | **finish this** |

### NOT TESTED - the next agent must do these

| Not tested | Why | How to test |
| --- | --- | --- |
| The countdown **on screen** | needs a seat, and a seat is a registration; Dan's instruction barred this lane from initiating registrations or seating | after activation: sit in any Spin, read "Deals In 7:00 At The Latest", **reload**, confirm it continues rather than restarting |
| Live ladder timings end to end | only observable on the activated engine | watch a board's `start_time` advance through its rungs |
| Convergence to 11/6 | same | the lobby's SPINS and SIT N GO'S tabs, and the census query in section 20 |
| Occupied games surviving the swap | the freeze has not happened | the three-snapshot method, section 21 Phase 3 |
| The feeder fix in production | not merged, not certified | after merge and certification |
| Client unit suite locally | only the touched file was run locally; CI ran the rest | `npx vitest run tests/` at the repo root |
| Any e2e / visual regression | out of scope for this change | CI runs them on the PR |

---

## 15. SETBACKS, FAILED APPROACHES, AND LESSONS

1. **The first feeder-exclusion attempt was insufficient.** Adding only
   `.eq('tournament_type','SNG')` missed the common feeder shape. Fixed by
   querying production rather than trusting a code comment.
2. **A migration was refused by the applier**: `FATAL 25P04: terminating
   connection due to transaction timeout`, inside **this lane's own assertion**,
   which called the slow function inside the applier's ~12 s transaction.
   Nothing was committed, so the file was corrected in place. The refusal is
   what exposed the hash-join over 3.08 M rows.
3. **`tsc` failures in a scratch clone** turned out to be a symlink-to-symlink
   `node_modules` breaking `@types` resolution. The change was moved to
   `/home/claude/ca-fix` with a diff/apply.
4. **Two engine tests went red** after widening the spread because they assumed
   "the hold is over" at a time now inside the band. Made **ceiling-relative**,
   not weakened.
5. **A stray non-ASCII character and em dashes** in the checkpoint were removed.
   Keep documents ASCII; the repo forbids em dashes in copy.
6. **`prettier --write` on the checkpoint reflowed 27 pre-existing lines**, which
   would have read as a revert to the Silent Revert Guard. Reverted and
   re-appended **without** prettier.
7. **This lane adopted another lane's defect and wasted a PR.** The
   sparse-checkout fix: four lanes, one missing folder, seven minutes. **Report,
   do not adopt.**
8. **Attribution error, caught by another lane:** the filesystem dependency came
   from **#10114**, not #10113. Corrected in the changelog.
9. **This lane's own detectors answered when they could not tell - three times:**
   - a poller treated "0 checks present" as terminal;
   - a watcher reported the selection artifact as `UNKNOWN` for ever because it
     paged 100 artifacts out of 76,996 and matched client-side;
   - an ancestry check printed `MISSING` for commits that were simply **not in
     the clone** (a PR head and two non-commit identifiers), which nearly went
     out as "the candidate lacks your change".
   All three were fixed. **Assert a minimum signal, re-read the current head,
   and fetch the object before judging it.**
10. **A stop-hook false negative:** a `fix/...` branch gets no tracking ref in
    this clone, so the hook reported "no remote branch" although `ls-remote`
    proved the push landed. Use `agent/...`.
11. **`/Volumes/SmarterArchives` is a read-only stale mount of symlinks.** The
    real volume is `/Volumes/SmarterArchives 1`. `device_bash` cannot mount it;
    `device_commit_files` is denied by macOS; the working route is
    `counselors__host_terminal`.
12. **An over-target day was nearly reported as a pass.** Retracted from both
    the reporting and the merged checkpoint.

---

## 16. KNOWN DEFECTS AND ARCHITECTURAL HOLES

| Priority | Defect or hole | Evidence | Impact | Recommended fix | Status |
| --- | --- | --- | --- | --- | --- |
| **P0** | Engine still serves the pre-ladder build | `/health` `version=391f7bc0`, instance unchanged all day | the entire behaviour is inert; nothing can be accepted | the release owner activates; this lane verifies | **blocked, not this lane's to perform** |
| **P1** | Release candidate blocked by an uninstalled migration `20261109132114` | release owner's 15:24Z comment on #10063; production read: not installed | the authorized window (expires 21:30Z) may lapse | financial owner's A/B decision on #10167 | **open, other lane** |
| **P1** | Feeder fix not merged | PR #10181 open | a feeder created today still takes the 3-4 h rung | merge after the release owner says it is safe | **held deliberately** |
| **P2** | Migration `20261109040704` in production, not on `main` | `schema_migrations` vs `git ls-tree origin/main` | breaks CLAUDE.md 2 rule 11; also makes a copy exported before 04:07Z refusable on inventory | the Kings Club lane records it byte-exact on main | **open, other lane, unacknowledged** |
| **P2** | Nine workflows red at their latest `main` run, with **no** open issue naming any | per-workflow newest-run survey, 10:45Z | the publish gate is red for everyone while the CI shard is red | BBJ lane's #10158 for the shard | **open, other lane; 1 of 9 acknowledged** |
| **P2** | `production-integrity-audit.yml` is itself red, and it is the only reader of a red `main` | its newest run failed 07:59:58Z | a repeat of the blocked selection would go unseen | its owner repairs the reader | **open, other lane** |
| **P3** | Cancelled feeders/MTTs show debits with no refund row | 7 days: 1,585 entries, ~17,663.00; horses 34.3% refunded, humans 33.3% | money may be owed; **cause NOT established** | a different lane must establish the cause before any number is treated as owed | **open, recorded, not acted on** |
| **P3** | `estate-digest.mjs` line ~313 reads `res.ok ? await res.json() : []` | code read | the exact shape CLAUDE.md 10.86 rule 2 forbids | its owner fixes it | **left alone deliberately** - not this lane's code, and changing notification behaviour on a cutover night is the wrong moment |
| **P3** | The feeder-check fallback prefers the ladder rung when the satellite read fails | by design, in `seatFirstNextWaitMs` | a feeder could be mis-paced if the read fails | accepted and documented trade-off | **by design** |

---

## 17. SECURITY, SECRETS, AND CREDENTIALS

No secret value was read, printed or stored. Names only:

| Name | Where configured | Used by |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Hetzner engine env | the engine (bypasses RLS) |
| `DATABASE_URL` | GitHub Actions secret | the selection job's read-only production read |
| `GH_TOKEN` / `GITHUB_TOKEN` | this session's environment | `gh` |
| `SP_EMAIL` / `TEST_USER_EMAIL` | `.env.local`, Vercel | the platform service identity `daniel@smarter.poker` |
| `PROBE_LOGIN_EMAIL` | World Hub env | the login probe |

Rules honoured: no `.env` value was read; Dan's personal account was never used
for a probe; no password was entered anywhere; no credential was scraped from
another lane.

**Flagged by another lane, not this one:** an exposed fine-grained PAT (owner
`Smarter-Poker`, expiring 2027-10-28) was scheduled for revocation after the
09:30Z selection. If `gh` auth breaks for the next agent, that is the first
thing to check.

---

## 18. DATABASE, MIGRATION, AND SEED STATUS

- Provider: Supabase Postgres, project `kuklfnapbkmacvwxktbh`.
- Installed migrations at handoff: **6994**.
- This lane's four migrations: **all installed and verified**.
- Rollback: **not tested** for any of them. Two are `CREATE OR REPLACE FUNCTION`
  (naturally reversible by replacing), one is an index, one is a law +
  backfill. **UNVERIFIED** whether a rollback was ever exercised.
- No seed scripts were touched.
- Relevant tables: `tournaments` (1,541 MB, ~991,799 rows at measurement),
  `tournament_players` (3,080,845 rows), `tables`, `table_seats`, `profiles`,
  `hand_history`, `ca_seat_stack_exits`, `financial_alerts`,
  `ca_owner_page_state`, `engine_maintenance_break`.
- New index: `idx_tournaments_started_at` on `public.tournaments(started_at)`,
  built `CONCURRENTLY` **before** `BEGIN;` using the sanctioned preamble, then
  asserted present and `indisvalid` inside the transaction.
- **Production-data risk:** none from this lane's migrations. The DDL policy was
  followed - one migration, one transaction, no DDL probes, no retry loops.
- **Known production/main drift:** `20261109040704` (another lane's).

---

## 19. CURRENT BLOCKERS AND DECISION POINTS

### B1 - the engine is not activated (blocks everything)

- **Blocked:** every acceptance check, and the under-300 measurement.
- **Why:** the ASAP operation `2026-11-09-owner-asap-engine-1530z` (notice live
  15:01:29Z, `notBefore` 15:30Z, `notAfter` **21:30Z**) has **not dispatched**.
  The release owner's 15:24Z comment: *"Candidate: blocked by uninstalled
  `20261109132114`. The financial owner's A/B decision is pending on #10167.
  Stage and receiver: none dispatched yet."*
- **Technical or authority?** Another lane's authority. **Not technical for this
  lane.**
- **Options:** (a) wait and keep reading their record - **recommended**;
  (b) ask the release owner for a status on #10063 if the window nears 21:30Z;
  (c) if the window lapses, the next activation is the ordinary 04:00 Chicago
  window with the sparse-checkout fix now on `main`.
- **Never:** dispatch Stage or the receiver, re-run a selection, write to the
  Backup host, or create a second operation. Owner-window, urgent and degraded
  replacement routes were **revoked** on 2026-11-06.

### B2 - PR #10181 merge timing

- **Blocked on:** the release owner's answer to this lane's question on #10063.
- **Why:** it touches engine source, so merging moves `main`'s newest server
  commit and could invalidate or re-queue a Backup certificate the live window
  relies on.
- **Recommended:** merge **after** their SEALED + thaw receipts, unless they say
  a merge now is harmless.

### B3 - UNKNOWN, NEXT AGENT MUST INSPECT

- Whether the release owner has answered either question on #10063 since 15:24Z.
- Whether the ASAP window dispatched, lapsed, or was superseded.
- Whether the Kings Club lane recorded `20261109040704` on `main`.
- Whether the BBJ shard and the integrity audit are green again.

---

## 20. REMAINING WORK

### CRITICAL

1. Verify activation, then verify the **SERVING** build's contents (not a
   candidate's) with `check-candidate-contents.sh <servingSha>`.
2. Confirm the **SEALED receipt** and a **complete thaw**.
3. Compare the two in-freeze snapshots (quiescence on both sides) and reconcile
   the 15:13Z pre-freeze snapshot against committed records.
4. Verify board convergence toward **11 Spins and 6 regular Sit & Gos**, with
   feeders consuming **none** of that budget.
5. Verify the **countdown persists across a reload** in a signed-in browser.
6. Measure the **first COMPLETE Chicago day** after activation against **under
   300 combined**, reporting human-triggered and horse-only separately plus the
   feeder count, and **derive the reporting date from the activation**.

### HIGH

7. Merge PR #10181 once the release owner clears it, then verify on main.
8. If the day misses the target, diagnose and **permanently correct the cause**
   within the agreed waiting behaviour. The lever is the **board count (11/6)**,
   not the rungs - see section 23's arithmetic.
9. Record the final result in `CHECKPOINT-seat-first-waiting-ladder.md` and
   refresh the SSD archive (the archived `acceptance-evidence.md` predates the
   ASAP window).

### MEDIUM

10. Chase the two unacknowledged handoffs (Kings Club migration; BBJ shard +
    integrity audit) only to the extent of re-asking in the inbox. **Do not fix
    them.**
11. Delete this session's worktree and scratch when the lane closes (Dan's
    standing preference), after the archive is refreshed.

### LOW / OPTIONAL

12. The satellite-heads-up ladder interaction could be simplified now that
    feeders are excluded from both the count and the ladder.

### EXPLICITLY OUT OF SCOPE - **DO NOT BUILD** (Dan, 2026-11-09)

- an ownership-lookup script
- release-workflow hardening (for example running the selector in the sparse
  checkout as a PR job)
- a digest trend enhancement

---

## 21. PRIORITIZED NEXT-PHASE EXECUTION PLAN

### Phase 0 - Recover and verify current state (do this first, ~10 min)

- **Prereqs:** none.
- **Inspect:** `curl -s "https://engine.smarite.poker/health"` -> **use the real
  host** `https://engine.smarter.poker/health?nocache=$(date +%s)`;
  `git -C /home/claude/ca-fix fetch origin main`; PR #10063's newest comments;
  PR #10181's state.
- **Completion:** you can state the serving SHA, the instance id, whether the
  ASAP window is live/lapsed, and #10181's check state.
- **Risk:** treating a stale read as current. Re-read, do not rely on this file.

### Phase 1 - Protect completed work

- Do **not** rewrite `CHECKPOINT-seat-first-waiting-ladder.md`'s history; append
  or edit the `SCOPE OF RECORD` section only.
- Do **not** force-push or rebase `agent/a-feeder-never-outlives-its-target`.
- Do **not** touch another lane's files (`stage-engine-release.yml`,
  `backup-engine.yml`, `estate-digest.mjs` beyond what is merged, BBJ SQL).

### Phase 2 - If NOT yet activated: hold position

- Keep a read-only watcher on `/health` for a serving-SHA, instance or phase
  change. **Assert it can read health**, so silence cannot pass for nothing.
- Re-read PR #10063 for the owner's record. Reply there only with the contents
  verdict if their selected build changes.
- Meanwhile: nothing else is blocked, because the pre-change days are already
  measured.

### Phase 3 - At activation (the five minutes that matter)

1. When `/health` shows the maintenance phase leaving `idle`, take **snapshot
   A** with `occupied-snapshot.sql` as soon as the freeze is **confirmed**
   (`maintenance.active = true`).
2. After the new engine is serving and still inside the freeze, take
   **snapshot B**.
3. **A vs B must be identical game for game.** Quiescence is confirmed on both
   sides and the engine replacement is the only thing between them. Name and
   account for any explicitly authorized maintenance write (a window migration,
   the break row).
4. After the thaw, take **snapshot C**. B vs C may differ **only** in these
   shapes, each checked against its own receipt: a game that COMPLETED (status
   + settlement receipt); a stack moved by a hand dealt after the thaw
   (`hand_history`); a game opened after the thaw; a seat exit with a matching
   `ca_seat_stack_exits` row and wallet credit.
5. Reconcile **15:13Z vs A** through committed records - those differences are
   legitimate play.
6. Run `verify-cutover.sh <servingSha>` for the runbook 4.8 checklist.
7. Run `check-candidate-contents.sh <servingSha>`; it must exit **0**.
8. Confirm the instance id **differs** from `1-a22c325d`, `resumeWaves` is
   complete, `handsInWindow > 0` within ten minutes of the thaw and
   `wholeFleetStalled` is false.

### Phase 4 - Convergence and the countdown

- Census query (the exact one):

```sql
SELECT CASE WHEN (t.satellite_target_id IS NOT NULL OR t.satellite_target IS NOT NULL)
              THEN 'feeder'
            WHEN t.variant = 'spin' THEN 'Spin board'
            ELSE 'heads-up board' END AS kind,
       t.status, count(*) AS boards
  FROM public.tournaments t
 WHERE t.status IN ('REGISTERING','RUNNING')
   AND (t.variant = 'spin' OR t.max_players <= 2
        OR t.satellite_target_id IS NOT NULL OR t.satellite_target IS NOT NULL)
 GROUP BY 1,2 ORDER BY 1,2;
```

- **Expect a one-time tail:** boards already at `seats-1` deal once after
  activation. At 05:46Z there were 36 Spins at 2/3 and 18 heads-up at 1/2. Empty
  boards are **parked, not cancelled**, so no refund is owed.
- Expect convergence toward 11 and 6 over hours, not minutes.
- Countdown: sit in any Spin, read "Deals In 7:00 At The Latest", **reload**,
  confirm it continues from the same absolute instant.

### Phase 5 - The acceptance day

- The first **COMPLETE** Chicago day after activation. Measure with:

```sql
SELECT * FROM public.fn_ca_seat_first_daily_starts('<YYYY-MM-DD>'::date);
```

- Report `starts`, `human_triggered`, `horse_only` per kind, with the feeder
  count separate. **Under 300 combined (Spin + regular heads-up) is the pass.**
- Derive the reporting date from the activation date. **Do not name it in
  advance.**

### Phase 6 - If the target is missed

- Diagnose with the split: mostly `horse_only` means the launcher is still
  opening or cycling too much; a large `human_triggered` share means the cause
  must be found before anything changes.
- **The lever is the board count, not the rungs** (section 23).
- Fix at the root, pin it with a test, and record it.

### Phase 7 - Close out

- Final numbers into `CHECKPOINT-seat-first-waiting-ladder.md`.
- Refresh the SSD archive folder (section 4) with the updated evidence.
- Delete the worktree and scratch.
- Report to Dan in plain English with the measured number.

---

## 22. EXACT FIRST ACTIONS FOR THE NEXT AGENT

```bash
# 1. the repo (a worktree; do NOT cd to the canonical clone)
cd /home/claude/ca-fix && git status --porcelain && git fetch -q origin main

# 2. read these, in this order
#    docs/HANDOFF-2026-11-09-seat-first-waiting-ladder.md   (this file)
#    CHECKPOINT-seat-first-waiting-ladder.md                (SCOPE OF RECORD first)
#    CLAUDE.md sections 2, 8, 10.5, 10.9, 10.11, 10.12, 10.85, 10.86, 11.5, 13
#    PUBLISHING.md and docs/ENGINE-RELEASE-RUNBOOK.md section 4.8

# 3. has the engine been replaced?
curl -sS "https://engine.smarter.poker/health?nocache=$(date +%s)" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);m=d.get('maintenance',{});print(d.get('version'), d.get('instanceId'), m.get('phase'), m.get('active'))"
#    391f7bc0 + 1-a22c325d  => NOT activated. Go to Phase 2.
#    anything else           => activated. Verify contents on the SERVING sha, then Phase 3/4.

# 4. the release owner's record (authoritative for the window)
gh api "repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/issues/10063/comments?per_page=100" \
  --jq '.[-6:] | .[] | "\(.created_at) \(.user.login): \(.body[0:400])"'

# 5. this lane's open PR
gh api repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pulls/10181 \
  --jq '"state=\(.state) mergeable_state=\(.mergeable_state) head=\(.head.sha)"'

# 6. the archived tools (note the space and the 1 in the path)
#    /Volumes/SmarterArchives 1/agent-evidence/seat-first-ladder-01BbZPDj-20261109/
#    reach them with mcp__remote-devices__counselors__host_terminal
```

**Do not modify:** another lane's workflows or SQL; the merged checkpoint's
history; the AI-opponent disclosure; the archive's `COORDINATION-INBOX.md`
except by appending.

**Resume at:** Phase 0, then Phase 2 if the engine is unchanged, Phase 3 if it
has been replaced.

---

## 23. ACCEPTANCE CRITERIA

The assignment is complete when **all** of these are observably true:

1. The engine serving production is a build whose **tree** contains
   `744549f379`, `ad998fc9` and `9aac3926` (`check-candidate-contents.sh` exits
   0 on the serving SHA).
2. A **SEALED receipt** exists for that release and `/health` agrees with it on
   SHA and instance id.
3. The thaw is **complete**: `maintenance.phase` idle, `resumeWaves` finished,
   hands dealing, `wholeFleetStalled` false.
4. The two in-freeze snapshots are **identical game for game**, with any
   authorized maintenance write named.
5. Post-thaw differences fall **only** into the four allowed shapes, each matched
   to a receipt.
6. Board census converges toward **11 Spin boards and 6 regular heads-up
   boards**, with satellite feeders in neither count.
7. A signed-in player sitting at an empty seat-first board sees **"Deals In
   7:00 At The Latest"**, and it **survives a reload** from the same absolute
   instant.
8. One **COMPLETE** Chicago day on that engine measures **under 300 combined**
   Spin + regular heads-up starts, with `human_triggered` and `horse_only`
   reported separately and the feeder count separate.
9. **No over-target day is described as a pass**, under any reading.
10. Horses remain refunded exactly as humans (already true; do not regress it).
11. Git is clean, every change is on `main` through a protected squash merge, and
    PR #10181 is merged or explicitly deferred with a reason.
12. The final number is recorded in the checkpoint and the SSD archive, and the
    worktree is cleaned up.

**The arithmetic behind the expectation** (so the first day is a comparison, not
a re-derivation):

```
Spin      11 boards, cycle 70 + 45 = 115 min avg  -> 12.5 starts/board/day -> ~137/day
heads-up   6 boards, cycle 210 min avg            ->  6.9 starts/board/day ->  ~41/day
combined                                          -> ~178/day before game duration,
                                                     which only lowers it
```

**160-180 is an ESTIMATE. It is not evidence and must not be reported as a
result.** If the measured day lands high, the lever is the **board count**, not
the rungs: the rungs are Dan's stated waits and are locked.

---

## 24. RECOMMENDED COMMIT STRATEGY

| Commit | Contents | Tests required first |
| --- | --- | --- |
| 1 | this handoff document | none (docs only) |
| 2 | nothing else until activation | - |
| 3 | `docs(seat-first): record the activation and its receipts` - the serving SHA, SEALED receipt, thaw, the three snapshots and their reconciliation | none (docs) |
| 4 | **merge PR #10181 as-is** once the release owner clears it | already green; do not amend it |
| 5 | `docs(seat-first): the measured <date> Chicago day against under 300` - the final number, both splits, the feeder count | none (docs) |
| 6 | only if the target is missed: a root-cause fix with its pin, in its own commit, plus its own changelog | the full seat-first suite + `tsc` |

**Never mix** a documentation commit with an engine change; the engine change
re-queues certification and a docs commit should not.

---

## 24b. LIVE LOG OF THE ASAP WINDOW (appended 2026-11-09 19:00Z)

Added after the handoff was first written, so the record does not depend on
that session surviving. Everything here is a read, with its time.

### The 04:00 break ran; only the replacement did not

The engine serving at 15:54Z still reported the morning break's resume waves:

    resumeWaves  total 3, done 3
                 startedAt  2026-11-09T10:05:00.091Z = 04:05:00 CST
                 finishedAt 2026-11-09T10:05:03.092Z = 04:05:03 CST
                 tables 58, tablesResumed 58, gapMs 1500

So the freeze, the five-minute window and the thaw all executed and put every
table back, in three waves, three seconds apart. `instanceId` stayed
`1-a22c325d` and `releaseSha` stayed `391f7bc0`, so the process was never
restarted - consistent with the blocked selection record.

**Why this matters for the next agent:** the break machinery is PROVEN working
on this engine today. If tables fail to resume after the ASAP swap, that is a
new fault introduced by the replacement, not a pre-existing one.

### Contents verdicts, every candidate this lane was asked about

All read from the candidate's own TREE with `check-candidate-contents.sh`,
never from ancestry. Exit 0 means the ladder, the feeder exclusion and the
full 3-to-7 minute window are all present.

| commit | what it was | verdict |
| --- | --- | --- |
| `391f7bc0` | the SERVING engine | exit 3, could not tell (the ladder file does not exist in that tree) |
| `af9ea7bc2d` | certified candidate | **exit 1, missing the 3-7 window** |
| `045886dd3c` | certified candidate | **exit 1, missing the 3-7 window** |
| `15303e5799` | first certificate carrying all three | exit 0 |
| `823501480a` | certified | exit 0 |
| `7b7e156427cf` | certified 15:27:10Z | exit 0 |
| `39a78e7b0bab` | certified 14:19:29Z | exit 0 |
| `3c9404ab1229` | #10173 window-booking head | exit 0 |
| `8d5aeb7bdbf9` | the booking, merged 14:55:07Z | exit 0 |
| `e366fab1398c` | candidate after #10179 retired the blocker; certified 16:32:56Z | exit 0 |
| `bff6eed3522e` | PLO-inclusive alternative | exit 0 (no certificate at the time of reading) |
| `aed5f975b16a` | newest certified on main, 17:45:23Z | exit 0 |

**The two exit-1 rows are the point of the exercise.** Both were certified and
both passed the installed-migration inventory while their human fill was still
3:00 to 3:30. Inventory and contents are two independent tests.

### Window state through the afternoon

    15:01:29Z  notice served and live (Publish Club Arena 42639373614)
    15:30:00Z  notBefore
    15:35:48Z  Backup certificate on e366fab1 goes pending
    16:32:56Z  that certificate goes success
    17:45:23Z  aed5f975 certified
    18:17:46Z  three Stage runs, all "Backup completion outside election"
    18:55Z     STILL no Stage or receiver dispatch; receiver's newest run is
               2026-11-07. Engine unchanged on 391f7bc0 / 1-a22c325d.
    21:30:00Z  notAfter - the window lapses

Two watch windows of 38 readable health answers each, plus one of 70, all
reported "no change" explicitly rather than going quiet.

The release owner's own 17:46Z note states their Claude operator "has not
responded since 15:37" and that their session is unavailable in the selected
account, with a Codex bridge observing rather than operating. **UNVERIFIED by
this lane** - recorded because, if accurate, the window may lapse with a
certified candidate in hand.

**Also observed, and flagged rather than concluded:** a comment on PR #10063 at
17:46:23Z is signed as this lane but was not written by this session. Every
lane posts under the same GitHub account, so authorship cannot distinguish
them. Its content matched what this lane would have said and referenced this
lane's own script by name. It was NOT treated as this lane's; the claim in it
was verified independently instead (that is the `bff6eed3` row above).

### Pre-change measurements, final

    Chicago day   Spin      regular HU   combined   human-triggered   feeders
    2026-11-07     6,670        5,847     12,517          1              4
    2026-11-08    11,369        7,705     19,074          5              4
    2026-11-09 to 15:01Z (partial, split day)
                   1,556        1,393      2,949          6              2

Census at 15:01Z: 78 Spin boards, 56 heads-up boards, 91 feeders in
REGISTERING or RUNNING.
Pre-freeze occupied snapshot at 15:13Z: 71 running seat-first games, 160 seats,
98,000.00 chips, fleet digest `83768267d6b2e6a9f80ba7ab938de9d3`. This is a
RECONCILIATION STARTING POINT, not a comparison baseline: play continues
between it and the freeze, so its differences against the in-freeze snapshot
are expected and are traced through committed records.

### PR #10181 (the feeder fix) at this point

Head `e51047e946`, **38 checks green, 9 skipped, 0 failures,
`mergeable_state: clean`**, and deliberately **NOT merged**. It touches engine
source, so merging moves main's newest server commit and could re-queue or
invalidate the Backup being soaked for the live window. The release owner was
asked twice, in one answerable line, and has not replied. **Hold it until they
post SEALED and a complete thaw, or say a merge now is harmless.**

---

## 25. FINAL CONTINUATION SUMMARY

**Exact stopping point.** All six deliverables are built and merged except the
satellite-feeder fix, which is green and deliberately held in PR #10181. The
client half of the behaviour is live and proven in the published bytes. **The
engine half is not live:** production still serves `391f7bc0` on instance
`1-a22c325d`, which has not restarted all day. An owner-authorized immediate
cutover window is open until **21:30Z today** and is stalled inside it on
another lane's migration decision. No acceptance check that depends on the new
engine has been performed, because none of them can be.

**Work on first.** Phase 0, then Phase 2 (hold position, read the owner's
record) if the serving build is unchanged; Phase 3 (the three-snapshot method)
the moment the freeze begins.

**Most important locked requirements.** Under 300 combined per Chicago day,
measured on a **complete** day. One horse opens a board; 11 Spins and 6 Sit &
Gos. Spin 60-80 then 30-60 minutes; Sit & Go 3-4 hours. A person who sits is
joined in **3 to 7 minutes**, drawn across the whole band. Horses are refunded
exactly as humans, 100% of the time. An over-target day is never a pass.

**Greatest technical risk.** The activation is not in this lane's hands and the
window expires at 21:30Z. If it lapses, everything slips to the next 04:00
Chicago window.

**Greatest data-integrity risk.** The post-thaw snapshot comparison. If a game
loses players or chips across the replacement, it must be caught by the
B-vs-C comparison and matched to a receipt, not explained away.

**Greatest reporting risk.** Reporting a partial or split day as a day. Measured
proof that this is a real hazard: Nov 8 read mid-day was 18,633 and closed at
19,074.

**Still requires the user.** Nothing from Dan is needed to continue. The only
open external dependency is the release owner's activation and their answer on
#10181's merge timing, both tracked on PR #10063.

**How to continue without restarting discovery.** Everything measured is in this
file and in `CHECKPOINT-seat-first-waiting-ladder.md`; every tool needed is in
the SSD archive folder with verified checksums; every number carries the time it
was read. Read Phase 0, check the serving SHA, and pick up at Phase 2 or Phase 3
accordingly. Do not re-derive the baselines - 2026-11-07 closed at 12,517 and
2026-11-08 closed at 19,074, both pre-change, and 2026-11-09 is a split day that
is not an acceptance result.

---

## 26. THE CUTOVER HAPPENED. ACTIVATION RECORD, 2026-11-09

Everything above section 25 was written while the activation was still pending.
It happened at 19:35:19Z. This section supersedes any sentence above that
describes the swap as outstanding, including section 25's "greatest technical
risk". Read it before acting on anything earlier in this file.

### 26.1 What was released, and why the selected build had to be re-checked

The release owner dispatched the selection job by hand at 19:27:06Z
(`stage-engine-release.yml` #5178, event `workflow_dispatch`, on main head
`9af491fd8440`). Its jobs: the server-tree proof succeeded, the daily release
evidence was recorded, window migrations were skipped (none queued), and the
exact-SHA dispatch succeeded. At 19:28:00Z the receiver
`auto-deploy-hetzner.yml` #2695 started on a `repository_dispatch`, titled
`Engine Release bff6eed3522ee894da747f91a532b35a3d8cee4f`.

**The selected component revision was `bff6eed3522ee894da747f91a532b35a3d8cee4f`**
("fix(lightning): pace 1/2 PLO startup and preserve play after departure",
#10195, 2026-11-09 16:27:57Z), an ancestor of main and 10 commits behind main's
tip at dispatch. It is NOT `aed5f975b16a`, the candidate this lane had verified
after its 17:45:23Z certification. The owner's instruction - an earlier
certified candidate does not prove the selected build is eligible - is exactly
what this case looks like in practice, so the contents check was re-run against
the tree of the build actually selected:

| requirement | verdict in `bff6eed352` | evidence in that tree |
| --- | --- | --- |
| waiting ladder | PASS | `SEAT_FIRST_OPENING_HORSES = 1`; `SPIN_LADDER = [{60,80},{30,60}] min`; `SNG_LADDER = [{180,240}] min`; rung index `paid - OPENING_HORSES` |
| feeder exclusion from the board budget | PASS | `seatFirstBoardRoom` filters `.is('satellite_target_id', null)` and `.is('satellite_target', null)` |
| the FULL 3-7 minute human fill | PASS | `HUMAN_PARTNER_HOLD_MS = HUMAN_ARRIVAL_MIN_MS`; `SPREAD = HUMAN_ARRIVAL_MAX_MS - HUMAN_ARRIVAL_MIN_MS` (the whole band, not 30 s); hold ends at `min(ceiling, partnerFloor + spread)` |
| client countdown mirrors the engine | PASS | `PARTNER_HOLD_MAX_MS = 420000`, `SPREAD = MAX - MIN`, `min(hero+420000, hero+180000+SPREAD)` |
| feeder lifecycle fix | ABSENT, EXPECTED | `seatFirstNextWaitMs` not present; it was PR #10181, held deliberately so it could not disturb this certification, and merged afterwards (squash `6506bc3cfc`) |

### 26.2 The cutover, minute by minute (all read-only observation)

| time (UTC) | what was true |
| --- | --- |
| 19:31:29Z | last-hand announcement. `engine_maintenance_break`: phase `last_hand`, reason `Deployment Recovery`, `declared_by` 391f7bc0, `enforce_freeze` true, ownership token `4a020a57`. `fn_platform_frozen()` still false |
| 19:33:29Z | `break_started_at`; `break_ends_at` 19:38:29Z |
| 19:33:55Z | **SNAPSHOT A**, inside the confirmed freeze (`fn_platform_frozen()` true), OLD engine 391f7bc0 serving |
| 19:35:19Z | NEW engine answering: build `bff6eed3`, instance `1-cc09e13a` |
| 19:35:57Z | **SNAPSHOT B**, still inside the SAME confirmed freeze, NEW engine serving, break row's `declared_by` now `bff6eed3` - the new engine took ownership of the break, so the freeze never lapsed between engines |
| 19:38:33Z | break over: phase `idle`, active false, 58 hands in flight, play resumed |
| 19:38:56Z | **SNAPSHOT C**, after the thaw: `fn_platform_frozen()` false and the `engine_maintenance_break` row CLEARED |
| 19:41:44Z | receiver #2695 `completed/success`, every job green, including `Record The Append-Only Engine Release Receipt` and `Dispatch Exact Cross-Artifact Production Certification` |

### 26.3 Custody across the replacement: A and B are identical

| snapshot | occupied seat-first boards | seated | chips on the felt | feeders | board digest |
| --- | --- | --- | --- | --- | --- |
| A (19:33:55Z, old engine, frozen) | 74 | 150 | 88,600.00 | 0 | `ac8634626f212bfd2fbaf826b739b8f5` |
| B (19:35:57Z, new engine, same freeze) | 74 | 150 | 88,600.00 | 0 | `ac8634626f212bfd2fbaf826b739b8f5` |
| C (19:38:56Z, after the thaw) | 73 | 169 | 100,300.00 | 0 | `532150937938ae39679d179253cd736a` |

The digest is `md5` over every occupied board's `id:seated:chips` ordered by id,
so an identical digest is a game-for-game, chip-for-chip match. **No occupied
game lost a player or a stack in the swap.** B to C moves only in the allowed
shapes: play resumed, +19 seats filled on boards that were waiting, +11,700.00
of buy-ins onto the felt, one board finished (74 to 73).

The snapshot query is `scratchpad/occupied-snapshot-detail.sql` in the session
scratchpad; it is reproduced here so it survives that scratchpad:
`tournaments` where `tournament_type IN ('SPIN','SNG')` and (`SPIN` or
`max_players = 2`) and status not terminal, joined to `tables` on
`tournament_id` and `table_seats` on `table_id` with `left_at IS NULL`.

### 26.4 The pre-freeze reading differs from A, and that is legitimate

A reference reading at 19:32Z was 84 boards / 174 seated / 98,800.00 chips, so
it differs from snapshot A at 19:33:55Z. Hands, seating and cash-outs occur
between the two, so this is expected rather than a discrepancy, and it was
checked against committed records rather than assumed:

- `ca_seat_stack_exits` - the trigger that records EVERY exit of a non-zero
  stack with the db role and application name that did it - has **zero rows**
  between 19:31:50Z and 19:34:10Z. No chips left the felt unaccounted for.
- 6 seats departed normally (`left_at` set) across 4 boards, 3,800.00 on
  departure, all between 19:31:50Z and 19:32:25Z, inside the last-hand window.
- 3 boards reached `ended_at` inside the window.

**OPEN ITEM, honestly stated:** the remainder is boards that finished and paid
out in the ordinary way, chips moving from the felt into wallets. That has NOT
been itemised line by line against `chip_ledger`. Nothing observed suggests a
loss - the one guard that exists for exactly this class found nothing - but the
itemisation is not done, and "no unaccounted seat exits" is not the same claim
as "every chip traced to a credit". Do not record this as closed until it is.

### 26.5 Serving identity and the sealed release, proved independently

The receiver's own jobs being green is not the proof. The serving engine
publishes its release identity on `/health`:

- `releaseSha` = `bff6eed3522ee894da747f91a532b35a3d8cee4f` (the full selected
  revision), `version` = `bff6eed3`, `instanceId` = `1-cc09e13a`,
  `leadership.role` = leader.
- `maintenance.schedule` = `{timeZone: America/Chicago, startHour: 4,
  startMinute: 0, frequency: daily, durationMs: 300000}`, next announcement
  2026-11-10T09:58:00Z = 03:58 Chicago. The daily window is intact on the new
  build.
- Platform at 19:42Z: 125 active tables, 55 active tournaments, 101 hands in
  flight, 3 humans seated, `liveness: ok`, `equityGovernor.scale` 1.

### 26.6 The reporting date, derived from the activation

Activation was 19:35:19Z = **13:35 America/Chicago on 2026-11-09**. Therefore:

- 2026-11-09 is a SPLIT day (old engine until 13:35 Chicago) and is **not** an
  acceptance result, however its number reads.
- **The acceptance day is TUESDAY 2026-11-10, America/Chicago**, measurable once
  it closes, i.e. after 2026-11-11 06:00Z, with
  `SELECT * FROM public.fn_ca_seat_first_daily_starts('2026-11-10')`.
- The target is under 300 COMBINED Spin + regular heads-up starts, with the
  human-triggered and horse-only columns reported separately and the satellite
  feeder row kept out of the combined figure.

### 26.7 The pre-change baseline, with the splits, for comparison

| Chicago day | Spin | regular heads-up | COMBINED | human-triggered | horse-only | feeders (outside the budget) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-06 closed | 4,859 | 4,860 | 9,719 | 1 | 9,718 | 4 |
| 2026-11-07 closed | 6,670 | 5,847 | 12,517 | 1 | 12,516 | 4 |
| 2026-11-08 closed | 11,369 | 7,705 | 19,074 | 5 | 19,069 | 4 |
| 2026-11-09 SPLIT (to 12:58 Chicago) | 2,520 | 2,351 | 4,871 | 6 | 4,865 | 3 |

Every pre-change day is essentially pure horse volume: human-triggered never
exceeds 6 in a day. Feeders run 3-4 a day at seat-first width, so the feeder
lifecycle never explained the volume.

An early rate read for orientation only, NOT an acceptance figure: 19:01-19:31Z
on the old engine produced 123 Spin + 119 regular heads-up = 242 starts in 30
minutes, about 8.1 a minute. The minutes immediately after a thaw are a resume
wave and must not be read as a steady rate.

### 26.8 What remains after this section

1. The acceptance measurement for 2026-11-10 Chicago (26.6).
2. Convergence toward 11 Spins and 6 regular Sit & Gos as the 73 boards already
   running drain. This takes hours by design: the ladder never closes a game
   that has players in it. The lever if the target is missed is the BOARD COUNT,
   not the ladder rungs.
3. The `chip_ledger` itemisation in 26.4.
4. The reload-countdown check, which needs a seated player. Observation may not
   seat one and must never borrow a real player's session. The arithmetic is
   verified in the live bundle: the page counts to 7 minutes from the moment the
   player sat and the engine's hold can only end earlier, never later.
5. PR #10181 (feeder lifecycle) is merged as `6506bc3cfc` and rides the next
   daily window; confirm it is in the build the 03:30 Chicago preparation
   selects.
