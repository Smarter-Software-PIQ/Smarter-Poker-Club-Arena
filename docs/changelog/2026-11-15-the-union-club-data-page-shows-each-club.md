# The union's Club Data page shows each club (2026-11-15)

**What was missing.** The union's own Club Data page (Midway Union, "All Member Clubs And Union Account") showed only the grand totals, so nobody could see from the page which part of the Fee and Total Winnings belonged to which club.

**What changed.** A "By Club" card now sits under the totals on the union's page only: one row per member club and one row "Union Account", each with its Total Winnings and Fee for the same window and filters. The rows add up to the totals to the cent. Tapping a member club opens that club's own Club Data page on the same dates.

The figures come from the same single read as the totals. Migration `20261115205153` replaces `ca_club_data_screen_union_basis` (behind its md5 preimage pin) so that its one pass over the window is grouped by club. Only the union's own answer gains the new `clubs` key. Every club's answer is unchanged.

**Proof.** On production (read-only) for 2026-11-02..2026-11-08: Deep Stack Society 452,206.43 / -562,209.57, KINGS CLUB 25,854.24 / -37,160.83, The Felt Society 455,510.12 / -473,091.31, Club Savage 0.00 / 0.00, Union Account 0.00 / +212.51. These add up to 933,570.79 / -1,072,249.20, which are the page totals and the weekly statements. The native fixture (`scripts/ci/test-club-data-accounting-read-model.py`) installs the previous reader from its own file and checks that its md5 matches production's. It then installs the new file through its guard and confirms three things for the plain, Hold'em, MTT and micro-stakes screens: every club's answer is byte for byte the same, the union's answer gains only `clubs`, and each member club's row equals that club's own answer.

Per-club game counts are not shown. A union table can deal one game to players of two clubs, and the page counts that game once, so per-club counts would not add up to the total.
