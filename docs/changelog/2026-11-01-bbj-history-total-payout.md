# BBJ History Shows The Full Event Payout

The recent-jackpot list used the bad-beat holder's personal share as its headline. It now reads the recorded `total_payout` from `fn_bbj_recent_hits`, labels it Total Paid Out, and uses the existing conservative compact chip formatter. Main and mini lists share the correction. Missing or malformed totals remain Unavailable instead of substituting a personal share or reconstructing historical splits.

Each entry gives the total a full-width header, the club avatar/name/date a separate row, and the losing and winning hands two aligned columns. Long names can wrap, the hand winner remains visible when archived cards are absent, and the heavy dividing lines become the console's existing engraved rules. The approved console frame, main/mini tabs, subscriptions, paging, keyboard activation and hand drilldown remain intact. No payment, schema or engine behavior changes.

Read-only production reconciliation confirmed the screenshot's three main payouts: 4636.78, 9923.12 and 5261.85, each equal to the sum of all six recipient entries. Regression coverage renders both main and mini and checks total versus individual share, invalid totals, recorded zero, retained winner identity and keyboard drilldown. The new tests fail on the prior implementation.
