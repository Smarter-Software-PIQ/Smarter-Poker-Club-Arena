# KINGS CLUB referral downlines, and the rule that detached them

**Owner of this record:** the chat that was asked, 2026-11-08, to reconnect
KINGS CLUB players to the agent whose referral link or referral ID they used.
Scope narrowed by Dan on 2026-11-09: "My authorization covers KINGS CLUB's
proven referral mismatches."

## What this task owns, and how to tell it is done

| # | Deliverable | Acceptance | State |
|---|---|---|---|
| D1 | The seven detached KINGS CLUB memberships reattached to the referrer the evidence names | every one resolves to its recorded referrer; the 699 players with no link and no referral ID unmoved | **done**, applied 2026-11-08 04:07 UTC, verified live |
| D2 | Three agent records whose own parent was detached, moved with their membership | each agent's parent matches its membership's upline | **done**, same transaction |
| D3 | The source defect fixed so it cannot recur | the join resolves a referral before the owner fallback; no path decides from a flag its own statement writes | **built**, in PR #10139, not yet merged |
| D4 | Regression coverage | 18 read-only checks against live records, plus a behavioural fixture in a throwaway database | **done** |
| D5 | Commission impact established and historical payments preserved | rake before each correction stays with the former upline; nothing settled is rewritten | **done**, verified against the real 2026-11-09 04:53 Chicago payout |
| D6 | One checkpoint holding the corrections and the evidence | `public.kings_club_downline_repair_20261108` carries the ten rows plus the install baseline | **done** for the corrections; the install evidence lands when D3 installs |
| D7 | D3 merged, installed from protected main, verified live | all three of: merged; `supabase_migrations` holds 20261109052000; the suite returns all-true against production | **blocked** — see below |

## What went wrong, in one paragraph

The 2026-10-25 orphan ruling ("a player with no agent sits under the club
owner") was implemented owner-FIRST: `fn_join_club_membership_impl` wrote
`agent_id = <club owner>` on the INSERT, before any referral code was read. The
only path that could move a player out of that placement,
`fn_redeem_club_invite_code`, was gated on `invited_by IS NULL` — and the same
UPDATE statement set `invited_by`. So the correction had exactly one attempt,
and if the inviter was not a settled active agent at that instant the player was
written back to the owner and the predicate could never match again. Seven
KINGS CLUB players were detached this way; Dagobaby is the clearest case, whose
referrer became an agent eight days after they joined with nothing to re-ask.

## What this task deliberately did NOT touch

Each of these was found while working and is left for its owner. None is a
blocker for D1–D6.

- **The account-closure reparent** (`fn_ca_deleted_account_leaves_every_club`).
  A draft of this work pointed the new resolver at it; review proved the
  resolver would hand a player back to the account being deleted, because that
  path re-homes the downline *before* it suspends the closing account. The patch
  was removed entirely rather than narrowed. A scope guard in
  `fn_test_referral_downline_rules` pins the hazard. **Owner: whoever owns
  account closure.** The observation worth passing on: a player reparented by
  account closure keeps whatever `agent_assignment_source` they had, so that
  flag can be stale there — conservative (a stale value is never automatically
  movable), but it is not the truth.
- **38 KINGS CLUB agent records** whose `agents.parent_agent_id` disagrees with
  their membership's `agent_id`. Predates this work, no referral evidence behind
  it, outside the authorization. The suite is scoped to the corrected set so it
  neither fails on them nor quietly rewrites them.
- **639 legacy rows under the club owner.** A draft inferred these were
  "nobody's choice" from `invited_by`. Seven proven mismatches were authorized,
  not 639 inferred ones, so the inference was removed: a row written before this
  migration is never automatically movable.
- **Main red on three unrelated jobs** as of 2026-11-09 14:00 UTC: another
  lane's `Apply 20261109132114_split_late_credit_journals_its_own_return.sql`,
  plus `certify` and `Live-table and engine verification`. Engine release is not
  this lane's. **Owner: the release lane.**
- **`supabase_migrations` version `20261109040704`** (the checkpoint table's
  original apply) has no committed `.sql` file. This delivery records the
  table's shape with `CREATE TABLE IF NOT EXISTS` so it installs anywhere, but
  the orphan history row remains. Closing it properly needs a byte-exact
  recording plus a manifest row (`scripts/ci/recording-only.mjs`).

## Shared dependencies, used rather than rebuilt

- **Commission accrual and the weekly settlement.** Not modified. Accrual banks
  against the upline at the moment rake is taken, and the settlement reads each
  membership's terms as of each rake event, so the corrections needed no
  accounting change at all. Verified by reading the receipts of the real payout
  that ran across the correction.
- **`fn_reassign_club_members`** remains the only authorized transfer path. This
  work records `manual_transfer` on the rows it writes and otherwise leaves it
  alone; its advisory lock is reused, not reimplemented.
- **`apply-merged-migration.yml`** is the only installer. No second dispatch,
  payout, repair or recovery operation was created.

## Defects found in this work before it shipped

Seven, none of which reached production: five by CI (an open SECURITY DEFINER
roster, wrong transaction packaging, a banned standing-repair shape, an
ungranted column, an undeclared new table), one by an independent review (the
resolver re-homing a player under a closing account), and one by the behavioural
fixture — `fn_club_placement_is_unchosen` returning NULL for a legacy row, which
made `NOT fn_club_placement_is_unchosen(...)` in the attach guard NULL and
silently disabled the refusal that protects another agent's downline. Only
running the code against data could find that one; the read-only suite counts
TRUEs, and NULL is not TRUE.
