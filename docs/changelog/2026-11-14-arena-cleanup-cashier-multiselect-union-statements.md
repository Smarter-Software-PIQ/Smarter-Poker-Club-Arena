# 2026-11-14: test accounts out, Midway roster, cashier multi-select, union statements on Monday, horse promo receipt

Owner request (Dan, 2026-11-14 10:02 Chicago), five items. What was measured, what changed.

## 1. PostDeploy test accounts across the Poker Arena

**Measured:** 1,273 reserved post-deploy identities (`ca-customization-cert-postdeploy-*@example.invalid`: 568 `PostDeploy*`, 705 `crest_cert*`) still held `profiles.status = 'active'`. 1,224 were already retired in Auth: the cleanup door's retained-ledger-actor branch signs a test identity out and keeps its profile because the chip ledger names it, but it never marked that profile deleted. 48 still held active memberships in 25 clubs (15.80 chips, no other custody).

**Root fix:** `cleanup_reserved_certification_account` marks the profile deleted in that branch, so the October 16 deleted-account triggers remove it from every club and list.

**Residue:** every reserved identity older than the 162-minute certificate age floor that owns no active fixture club is marked deleted through the same triggers. Rehearsed in a rolled-back block: 1,260 identities, 15.80 chips returned to the one receiving club bank, 0 active memberships left, 4.3 s.

**While a run is live:** the post-deploy run still holds the staff roles it certifies (the Lightning operator certificate is a Midway admin, Dan 2026-10-24 "Admin on Midway"), but `fn_club_cashier_members_page_v3` no longer lists a test identity to anyone but itself, and invoice delivery never addresses one.

## 2. Midway Union roster

Johnny, Danny, minhloc73gr and Chase45 leave through `fn_remove_settled_club_member` acting as KingFish (audited, records retained); none held a balance, seat, entry or request. PostDeployf5601 leaves with item 1. KingFish and SmarterPokerOfficial remain.

## 3. Cashier multi-select "silently fails"

**Measured:** `cashier_operations` held no batch of more than one recipient in thirty days. Reproduced on production (Midway cashier, two then three players, Send Out, never confirmed): the dialog grows one card and one amount row per player, and scrolled to its end its Cancel and Confirm plates lay under the fixed bottom nav (Confirm at 628-700 px against a nav from 642 px; `elementFromPoint` returned the nav link). The overlay sat inside the page's stacking context under the header (390) and the nav (1000), and a z-index cannot lift it (400 measured, still under the header).

**Fix:** the overlay reserves the header's measured height (`--ca-global-header-height` / `--ca-in-tab-header-height`) and the footer's live height (`--bottom-nav-stack-base`). Verified with the fix injected: Confirm at 559 px against a nav at 642 px (1024x768) and 732 px against 791 px (393x852), hit-tested as Confirm. The batch path (`fn_cashier_batch_transfer`) was never the defect. Law: `tests/cashier-dialog-clears-the-chrome.law.test.ts`.

## 4. Union invoices to clubs, inside the weekly automatic rakeback

**Measured:** the per-club square-up (`union_weekly_squareup`: club owes union / union owes club / square) is calculated by `fn_union_issue_weekly_invoices` and shown on the Union Statements board, but

- it was never sent: `fn_deliver_accounting_invoice` has recorded non-cashout invoices only since 2026-10-15, so every union close since shows notified 0 while the board says Delivered, and `fn_get_user_conversations` hid such threads;
- it arrived days late: the Monday payout pays rounds 1-3 through the round runner, but the union's books (P&L certification, a tournament proof per club, ECO, square-ups) were left to job 272 (240 s tick, 3-minute scope budget, mean 45.7 s, max 241.6 s). Midway's close took 130 attempts for the week ending 2026-11-09 (done 2026-11-11 09:06 UTC), 272 for 2026-11-02, 282 for 2026-10-26.

**Fix:**

- square-ups and union credit notes go through the existing accounting Messenger delivery to the club's owner and staff and the union's owner and admins; the union's own hub row stays record-only; the inbox lists the thread;
- `weekly-union-books` (every two minutes) runs the same close tick job 272 runs, with the close's default 8-minute scope budget and a 15-minute statement, from the released Monday payout until every union it covered has a complete close, at most twelve hours;
- when round 4 records, the union's owner and admins get one notification naming each club and what it owes or is owed, linked to the Union Statements board;
- the latest closed week's square-ups were delivered once.

## 5. Weekly horse promo

**Measured:** it ran last week. `fn_midway_weekly_horse_promo`, from the weekly cascade, 2026-11-09 14:46 UTC: 90,274.35 promo chips (50% of 180,548.70) split 90.27 / 90.28 across 1,000 distinct horses that generated rake; no horse holds two active Midway wallets. Nothing reported it.

**Change:** the payout report recipient gets one receipt per week (budget, horses, share). Eligibility, budget and the split are unchanged. No backfill.
