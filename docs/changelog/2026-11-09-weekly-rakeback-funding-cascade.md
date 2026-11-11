# Weekly rakeback is funded down the hierarchy, from the latest certificate only

2026-11-09. Owner-approved the same day. This entry describes source that is
merged or proposed for merge. **Nothing here is installed on production as this
is written**, and nothing below should be read as live behaviour until the two
migrations are recorded in `supabase_migrations.schema_migrations` and a weekly
run has passed with them.

## What was wrong

Before round 3 of the weekly payout, the runner
(`smarter_private.weekly_payout_next_round`) calls
`smarter_private.weekly_payout_fund_agent_shortfalls`. The installed body was a
top-up: look at each paying agent's wallet, and send the difference from the
club bank straight to that agent.

Two defects, both in that one function:

1. **It summed every certificate version (D5).** A period in
   `accounting_rakeback_period_calculations` can hold several certificate
   rows; the latest is the one with the highest `id`. The function joined all
   of them, so a superseded certificate was funded again on top of the current
   one. On the week of 2026-11-02 that sent **326.91** too much from a club
   bank to one agent wallet (Kings, agent `9b027798`).
2. **It skipped the recorded hierarchy (D6).** It paid club bank to payer
   directly, whatever agents sat between them, and it measured the need from a
   wallet balance instead of from the agreement.

It was also a compensating write by design: it existed to repair a wallet that
round 2 had left short. CLAUDE.md 10.12 does not allow that shape as an answer.
It was never listed in `docs/BAND-AIDS-REGISTER.md`, so there is no register
row to remove; this entry is the record that the behaviour is gone from source.

## The 326.91 stays where it is

The over-funded 326.91 from 2026-11-02 is a settled transfer. By owner decision
it is **left in place**: nothing takes it back, nothing nets it against a later
week, and neither migration touches it. The house absorbs its own defect
(CLAUDE.md 10.9, rule 3).

## What changes

Two migrations, both DDL only, neither writes a row:

- `20261109231325_owner_routing_wallet_is_wallet_only_and_earns_nothing.sql`
- `20261109231855_weekly_rakeback_funding_cascades_down_the_hierarchy_from_lat.sql`

### The funding model: each chip is counted once

The function keeps its name, signature and call site. Its body is now an
upfront plan built from the agreements, not from wallet balances.

- **Latest certificate only.** One certificate per pending period, the highest
  `id`. A superseded version contributes nothing.
- **Owed** per player comes from the certificate
  (`smarter_private.rakeback_certificate_wallets`).
- **Covered** is the paying agent's own commission on exactly the sources that
  certificate allocates to that agent. Round 2 has already put those chips in
  the agent's wallet.
- **Need** for one agent and one player is `max(0, owed - covered)`. It is
  never netted across players: a player the agent over-covers does not pay for
  one the agent under-covers.
- **Pass-through** for an agent is the sum of its needs. What flows into a
  wallet is its own commission, plus its pass-through, plus everything bound
  for the agents below it. What it keeps is its own approved entitlement and
  nothing else. A retained commission percentage is not a ceiling on what
  passes through a wallet.
- **Route.** Each need travels club bank, then top agent, then each agent
  below, down to the payer, along the agent agreements in force at each
  allocation's agreement time (`accounting_agreement_history`). There is one
  transfer per hierarchy edge per club per week, parents first, each with its
  own `chip_ledger` row and paid receipt, keyed
  `rakeback-cascade:v1:<club>:<week start>:<payer or club>:<payee>`. The key
  carries no run id, so a second run of the same week cannot fund twice.
- **A deleted upline is routed around.** A credit to the agent wallet of a
  deleted account is returned to the club bank by the installed
  `zzzz_deleted_agent_credit` trigger inside the crediting statement, so chips
  sent through such an upline would never reach the next hop. The path
  therefore skips an upline whose profile is deleted and continues to its
  nearest live upline, or to the club bank when there is none. This is the
  same collapse already applied to an owner sitting above an agent. Nothing
  is credited to the deleted account, and two or more deleted uplines in a
  row are all skipped. The plan returns the accounts it skipped
  (`skipped_deleted_uplines`). A deleted **direct payer** is not skipped: what
  it owes its players is held back for it by the published-rakeback reserve,
  so it is funded and round 3 pays its players from it, as before. One shape
  cannot be routed and is refused, naming the club and both accounts
  (`rakeback_cascade_upline_deleted_after_funding`): an upline that already
  passed this week's funding down and was deleted afterwards, where a new
  route would fund the same agent twice. On production today one agents row
  on a deleted profile has child agents (Kings, top-level super agent
  `af6dc0cc`, wallet 0.00; its three child agents are deleted too, one with
  two players). Under this rule a need for those players would travel club
  bank to that child agent directly.
- **Affordability first.** A club whose week costs more than it received after
  the union share is refused before any transfer, with an error that names the
  club (`rakeback_cascade_club_cannot_afford_week`).
- **Unassigned players** (no upline at all) keep the existing club bank to
  player route.

Round 3 (`fn_settle_accounting_rakeback_stage`) and its two validators
(`rakeback_wallet_payout_complete`, `split_rakeback_payout_complete`) change
only to recognise the owner wallet route below, and only for legs that carry
its marker. No ledger row carries that marker today (0 rows on production,
read 2026-11-09), so every week already paid is judged exactly as before.
Nothing settled is replayed.

### The wallet-only row

When the club owner is the recorded upline of a player, the required route is
club bank, then the owner's agent wallet, then the player. An owner with no
`agents` row has no agent wallet, and the only older way to get one
(`fn_ensure_agent_row`) mints an **active** row at the union minimum
commission. That is an earning agreement nobody made.

So `agents.status` admits a fourth value, `wallet_only`:

- commission 0, player rakeback 0, no parent, no credit line, held there by the
  CHECK `agents_wallet_only_earns_nothing`;
- created only by `smarter_private.ensure_owner_routing_wallet(club)`, only
  for the club's current owner, opening empty, and only when the owner holds no
  row. An existing row of any status is returned untouched;
- never converted from an existing row, and never activated without a real
  rate (`zz_owner_routing_wallet_guard`);
- ignored by every earning, permission and report reader, because those
  already filter on `status = 'active'`.

Owners with an active agent row today (Felt, Club Savage, Kings) keep that row
and simply have it funded. Deep Stack Society's owner holds no row and would
receive a wallet-only one the first time that club needs the route.

### The client roster

`AgentService.getAgents` refused the whole roster with "The Agent Record Is
Malformed (agent.status)" on any status outside active, suspended and frozen.
One wallet-only row would therefore have blanked Agent Management, the agent
tree, the club detail agent list and the super agent dashboard for that club.
The roster now leaves wallet-only rows out before parsing: the row is a wallet,
not an agent, so it is neither listed nor counted. An undefined status still
fails closed.

### The server lists and counts

A wallet is not an agent, so no server response lists or counts it as one.
Three installed readers returned every `agents` row of a club without reading
its status. The wallet migration replaces each from its installed body (md5
refused if it has changed) with one added exclusion, `status <> 'wallet_only'`,
and nothing else:

| Function                                          | Installed md5                      | What it answered                                                 |
| ------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `public.fn_ca_agent_payables(uuid)`               | `5b86542b4686a504209767ac9a70e1e8` | Payouts tab rows and the `agents` count                          |
| `public.get_club_agents(uuid)`                    | `7c4fc71f953f809d1d4e40780c747ac0` | the agent list (no caller in `src/` today)                       |
| `public.fn_club_opening_checklist_complete(uuid)` | `0e51fff026d1e37b1c143bbfb1fe021f` | the "first-agent" opening step, which any `agents` row satisfied |

The Payouts tab's strict client mirror (`src/utils/agentManagementPayload.ts`)
refuses an unknown status and requires the row count to equal the server's
`agents` figure, so one wallet-only row would have shown "The Commission
Ledger Could Not Be Read" for that club. Row list and count come from the one
filtered read, so they still agree. For a club with no wallet-only row all
three functions answer exactly as before (executed in the wallet harness
against answers recorded before the migration).

Read and left alone, because they already leave the row out or are not agent
lists: every reader that filters `status = 'active'` (roster, member detail,
coverage, statements, rake by agent, the financial summary's agent count), and
the money readers that must include the wallet
(`fn_cashier_conservation_report`, `fn_cashier_recipient_wallet_balances`,
`fn_club_union_join_blockers`). Not changed: the view `public.club_agents`
(every row with its status; no caller in `src/`) and
`fn_club_rakeback_margin_violations` (service role only, no caller found),
which will describe an owner-upline player against the wallet row's zero rate
where it used to report "no resolvable upline".

### Where the owner sees and reclaims the balance

Read from source and from the installed definitions, not checked in a browser:

- **Seen:** the owner's own Cashier pages read their `agents` row by club and
  user with no status filter (`CashierPage`, `CashierTradePage`,
  `cashierBalanceRead`), so the balance shows as the owner's Agent Wallet.
  `fn_cashier_recipient_wallet_balances` returns it for a member whose club
  role is owner, and `fn_cashier_conservation_report` counts it in the club's
  agent wallet inventory.
- **Reclaimed:** `fn_club_wallet_claim_back` (source `agent_wallet`,
  destination `club_bank`), the Cashier's management Claim Back. Executed in
  the wallet harness for a wallet-only row, for the same row after suspension,
  and by a new owner after an ownership transfer.
- **Not seen:** the member roster and member detail
  (`ca_club_roster_rows`, `ca_club_member_detail`) add up agent wallets of
  `active` rows only, so a wallet-only balance does not appear in those two
  figures. This is open. In normal running the wallet ends each week at 0.00:
  it is funded with exactly what round 3 then pays out of it.

## Known deviations from the required cascade

- **Round 2 is unchanged.** Commission still moves in round 2, and the
  pass-through moves in the funding step before round 3. A top agent that has
  pass-through funding therefore receives **two upfront receipts** for one
  week (its round 2 commission, then its cascade funding) instead of the single
  transfer the owner's rule describes. The amounts are right and each chip
  moves once; the paperwork is two documents. Folding the pass-through into
  the round 2 transfer is the noted follow-up; round 2's chunked path and its
  validators pin commission amounts and were deliberately not touched here.
- **The owner as an intermediate upline** is still collapsed to the club bank,
  as round 2 does (owner ruling 2026-10-22). The owner's agent wallet is used
  only where the owner is the direct recorded upline of players.
- **Funding legs write no `chip_transactions` or `wallet_transactions` row**,
  matching round 2. Each has a ledger row and a paid receipt.
- **The top-up is gone.** An agent who spends its commission between round 2
  and round 3 is no longer topped up from the bank; round 3 refuses with
  `routed_rakeback_agent_funding_shortfall`.

## What is not yet verified

- Neither migration has run on production or on Backup. The real rounds 1 to
  3 have not been executed end to end with both installed.
- The funding harness uses stand-ins for rounds 1 and 2, the receipt trigger
  and the round ownership checks. The real-guards harness
  (`scripts/ci/test-rakeback-cascade-real-guards-postgres.py`) runs the funding
  legs and round 3 under production's own triggers and functions as read on
  2026-11-09, but its rounds 1 and 2 are copied statements, not the stages,
  and the weekly runner itself is not loaded.
- The deleted-upline route is executed in that fixture only (middle, two in a
  row, top level, deleted after funding). A deleted direct payer funded by
  another agent, instead of by the club bank, relies on the same reserve and
  was not run as its own case.
- Affordability counts round 2 commission paid to an agent whose account is
  deleted as spent, although the deleted-wallet return sends it back to the
  club bank. That is the cautious side: it can refuse a tight week, never
  overspend one.
- The multi-level hierarchy walk is proven in the fixture only. On the one
  production week examined, the single payer with a need had no parent.
- Timing on production is not measured. The owner-upline test expands every
  certificate's allocations (about 1.8 million that week).
- `fn_close_account` and `fn_remove_settled_club_member` refuse on any
  `agents` row. A former owner holding a wallet-only row joins that existing
  class. Club retirement's treatment of agent wallet balances was not
  established.
- None of the client surfaces was checked in a browser with a wallet-only row
  present.
- The roster and member detail figures described above.

## The preparation shards could not record a unit

Found while running the real weekly runner in the fixture, and confirmed on production (read only).
`smarter_private.weekly_prep_shard` declares a variable named `units` and then runs
`UPDATE ... SET units=units+1`, which PL/pgSQL refuses as an ambiguous reference. On 2026-11-09 each
of the four preparation shard jobs failed about 167 times, recorded 0 units, and the weekly run was
booked at 10:47Z, about 47 minutes after its 10:00Z payout time.

Migration `20261110053814` replaces the procedure from its installed text with only those two
references qualified, pinned by preimage and postimage md5. It is not a window file and installs at
merge. The real-runner harness first shows the installed body failing on all four shards, then
installs this file and pays the week on the first eligible ticks.

The real-runner harness (`scripts/ci/test-rakeback-cascade-real-runner-postgres.py`) loads 499
production functions byte for byte, installs all three migrations and drives production's own
`weekly_payout_next_round()` with the cron command, one connection per tick: preparation, booking,
round 1, round 2, funding with round 3, finalize, then proves that further ticks move nothing.

## Install route

**Changed 2026-11-11: both files install at merge, not in the daily window.**
They first declared `-- @install-window: daily-maintenance` and were never
installed. From 2026-11-04 to 2026-11-11 the daily preparation that runs the
window installer reached it once (refused, 2026-11-10 17:03Z); on 2026-11-11
the reserved preparation (run 42959839523) stopped at 09:30Z with "Release
controls changed during reservation; keep serving", and the owner-window
release dispatched at 09:20Z skips the window job by design. Relying on four
more nights of that before the 2026-11-16 payout was not a delivery route.

`public.agents` is not one of the three hot tables the window rule names
(clubs, tables, hand_history), and the cascade locks no table, so both are
ordinary files: Apply Merged Migration sends each once, in version order, in
one transaction under `lock_timeout` 1 s and the applier's 12 s bound. Never
apply either by hand or through the Supabase MCP.

**The wallet migration must install first**: the cascade refuses with
`rakeback_cascade_requires_owner_routing_wallet` until
`smarter_private.ensure_owner_routing_wallet` exists. If the cascade's applier
run reaches the database before the wallet's has committed, it refuses whole
and installs nothing; it is then dispatched once more after the wallet file is
recorded. The wallet file takes ACCESS EXCLUSIVE on `public.agents` only for
its constraint swap and one trigger; if the lock is not granted within 1 s the
file rolls back whole.

The wallet file now also replaces three functions, each guarded by its
installed md5. If any of the three, or `fn_enforce_agent_commission_bounds`,
is changed on production before it installs, the wallet file refuses whole and
the cascade refuses behind it; re-read the changed function and update the file.

The next weekly payout is Monday 2026-11-16.

## Proof and where it runs

Four PostgreSQL 17 harnesses run in the required check **Weekly refusal
receipt cover** (`.github/workflows/weekly-refusal-cover.yml`) on any pull
request that touches a migration, a harness or a cascade fixture:

- `scripts/ci/test-rakeback-cascade-funding-plan-postgres.py` (the planner)
- `scripts/ci/test-owner-routing-wallet-postgres.py`
- `scripts/ci/test-rakeback-cascade-funding-postgres.py`
- `scripts/ci/test-rakeback-cascade-real-guards-postgres.py`

Each is named directly in its step, so a missing or failing harness turns that
required check red. `tests/superseded-certificates-never-fund.law.test.ts`
pins the two causes, the deleted-upline rule, the server exclusions and the
install order in source, and keeps the four steps wired.
