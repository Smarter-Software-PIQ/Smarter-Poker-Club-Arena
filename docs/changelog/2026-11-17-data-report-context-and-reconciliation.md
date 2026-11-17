# Data Report Context And Reconciliation

Data and Report retain inclusive Pacific dates, game and stakes filters, search, and the selected report tab. Member navigation retains a return link to the originating report; member ledger figures retain their existing Chicago financial basis. The Data rake panel follows report dates until an operator deliberately chooses another period.

Reports expose inclusive calendar labels beside their existing Chicago boundary timestamps, metric definitions, the current snapshot and billing coverage evidence, links to contributing games and player totals, and issued invoice history. A contributing game opens its actual source identity and selected-window figures. Revision reasons that the snapshot does not contain are explicitly unavailable. CSV files retain exact amounts and add source identity, selected dates, scope, filters and actual time-zone metadata.

Owner direction limits Data selections to the past 90 calendar days, including today. Older bookmarks are refused visibly; stored financial history is preserved. Other financial pages retain their existing ranges.

The recent-game SQL reader aggregates the visible games' facts once instead of running repeated per-game aggregates. Read-only production comparison on Midway's November 9–15 report proved exact ordered JSON equality; the candidate query measured approximately 725 ms versus the original helper's 1,447 ms. These measurements are observations, not latency guarantees. Installation, protected publication and live proof are recorded separately in the owning task checkpoint.
