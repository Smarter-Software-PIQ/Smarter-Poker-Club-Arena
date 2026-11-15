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

## State
- pushed: e5a534b23 (previous agent). Local: c2b1c59a8 (not pushed yet).
