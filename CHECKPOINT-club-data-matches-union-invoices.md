# CHECKPOINT: Club Data matches the Midway union invoices (PR #10879)

Owner specification: chat attachment "INVOICES + CLUB DATA - COMPLETE ACCOUNTING
RECONCILIATION AND LIVE DELIVERY" (15 sections). Single writer: this session
(session_01Gw7aDrH1bjSVQ1fPQtpufA), taking over the previous agent's
continuation. Branch `agent/claude/club-data-matches-union-invoices`,
worktree /home/claude/wt-club-data.

## Receipts
- 2026-11-15 00:23Z policy reader `node docs/agent-policy/agent-policy.mjs read`
  (policy 2.9) read in full with CLAUDE.md, AGENTS.md, AGENT-PLAYBOOK.md,
  PUBLISHING.md, REFERENCE-INDEX.md, OPERATING-LAW.md, HARDENING.md, OWNER-POLICY.md.

## Shard-3 diagnosis (verified)
- Run 43656507926 job 132636172709: only tests/unit/LeaderboardService.test.ts
  failed (10 cases): the resolver's added `ca_club_id_for_slug` RPC consumed
  the mocked RPC sequence. Table read of club_slug_history: both files pass
  locally (46/46). Committed c2b1c59a8.

## Accounting contract (measured on production, read-only)
- Invoice row = fn_union_club_invoice: rake_generated = sum(accounting_payable_earning_sources.rake_credit)
  [cash earned_at, tournament recognized_at]; rakeback_due = round-1 payout;
  players_won = realized flows + delta holdings (fn_union_pnl_evidence_report);
  cash part = per-hand observed_stack_delta by earning_club_id (touches + link
  resolutions) + BBJ stack awards (fn_union_pnl_week_bbj_stack_awards);
  tournament part = tournament flows + delta deferred_tournament_result holdings
  (pnl_boundary certificates); settled_in_chips = player_pnl_net + rakeback_due;
  outstanding = eco_amount + presettled.
- Verified exact: Kings tournament funding 103,757.00 / returns 116,603.72 from
  union_pnl_original_flows equal the certified pnl_flows windows; opening
  deferred 30,858.66 closes the gap to -18,011.94. Raw touches+links equal the
  certified pnl_hands_window per (club,user) for 2026-11-02 (full day) and the
  2026-11-03 08-10Z window.
- Read-time costs (why a read model is required): Felt cash fees for one week
  66 s; union flows for one week 8.7 s; one 2 h of touches 1.8 s.

## Plan
Stage 1 (PR #10879): accounting-day functions, slug history (existing), an
accounting-basis Club Data read model (tables + projection functions + seed),
live projection triggers installed in the 04:00 Chicago window.
Stage 2 (follow-up PR after the window): seed history before live_from, verify
against certified partials and the five invoices, switch the Club Data readers,
client 2 AM presentation, publish, live verification.

## Design change on takeover (2026-11-15 01:40Z, session 01Gw7aDrH1bjSVQ1fPQtpufA, lead)
- The predecessor split seed/live by inserting xid (live_xid, xmin ages). Replaced
  by: live triggers write src 0 for every insert after attachment; the day load
  writes src 1 = whole day - src 0 in one REPEATABLE READ snapshot. Removes the
  cutover-spanning-transaction and lock-order gaps, and gives every day (live or
  history) an explicit idempotent rebuild (fn_ca_club_acct_seed_day(day, true))
  that also resolves recorded projection failures. Seed script/workflow load in
  REPEATABLE READ, optional rebuild input.
- goes_live @locks now names all nine relations it creates triggers on.
- Production trigger cost measured read-only: touch participant resolution
  0.039 ms/hand (300 recent hands); existing trg_ca_club_data_fact_rake already
  uses the same per-row EXCEPTION pattern on the hand path.
- Native proof (PG16 local, as user claude): 9/9 PASS incl. load-before-live,
  load-after-live, later escrow correction, failure resolved by reload, rebuild
  idempotent (md5 equal).
- 20261114235606 NOT installed on production yet (club_slug_history absent,
  checked 01:10Z); Felt Society a0000000-...0001 slug = the-felt-society.

## Review B1 redesign (2026-11-15 02:30Z, accepted by coordinator with conditions)
- Live aggregate rows (src 0) are written only under a never-waiting one-key
  try-lock pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:' || key, 0))
  (coordinator: not the two-key form; home-group functions take blocking
  two-key locks with a hashed classid). Otherwise an insert-only journal row.
  At most 32 locks per transaction. Readers sum aggregate + journal once; the
  day load folds the day's journal rows of its snapshot into src 1.
- src 1 written only by the day load (one at a time, try-lock); src 2 only by
  the boundary loader (try-lock per boundary). No shared hot game aggregate
  (ca_club_acct_game dropped). Every trigger function lock_timeout 50ms.
- Union scope only (non-union outcomes carry no earning club; measured
  12,246 per 6 h). Tournament flows classified by receipts, projected at
  commit one row at a time (deferred constraint trigger): measured 24 h, 15,008
  union tournament flows, every one owned by a receipt with the flow's own
  transaction_id. A shaped touch and its escrow certificate take the hand's
  try-lock (a concurrent pair records a failure instead of silently missing
  the reshaping); measured 0 shaped touches in 6 h, 9 certificates in 7 days.
- Boundaries from ca_union_pnl_boundary_capture (#10899) through
  fn_ca_union_pnl_boundary_for_invoice(union, boundary, invoice created_at):
  never a later version; a side with no qualifying version loads nothing and
  is logged not invoice-exact. Production: week 2026-11-02..09 invoices
  created 2026-11-11 09:05:00Z, after both boundary certificates (01:52, 03:43)
  -> both sides exact; week 10-26..11-02 invoices created 2026-11-10 16:05Z,
  before the 11-02 certificate -> that closing side not invoice-exact.
- Boundaries load through fn_ca_club_acct_load_boundaries (seed script, own
  transaction), not inside the 12 s install budget.
- Native proof PG16 (as user claude): 16/16 PASS incl. two sessions: same-row
  live write 0.02 s (journaled, no wait), locks one-key only, day load beside a
  live commit 0.08 s with every hand once, journal folded, 32-lock budget.

## Receipts reconciliation, week 2026-11-02..09 (union fade0000-...0001, read-only)
- Funding/returns by receipt: Deep Stack 2,052,426.50 / 1,880,477.22;
  The Felt Society 2,029,901.00 / 1,951,998.47; KINGS CLUB 103,757.00 / 116,603.72.
- Deferred holdings at 2026-11-02: DS 32,112.08, FS 30,942.59, KC 30,858.66;
  at 2026-11-09: DS 8,507.25, FS 7,218.35, KC 0.
- Result = returns - funding - opening + closing: DS -195,554.11,
  FS -101,626.77, KC -18,011.94, each equal to its invoice to the cent.

## State
- #10899 (boundary capture) head 58b622594 pushed: S1 invoice-version function,
  N2 ENABLE ALWAYS asserted via pg_trigger. Waiting on CI + reviewer delta.
- #10879: redesign written (20261115020010 / 20261115020011), N4 STABLE,
  former-slug refusal in 20261114235607, BAND-AIDS entry, seed S8, pg pinned.
