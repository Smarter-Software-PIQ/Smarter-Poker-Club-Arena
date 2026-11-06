# Player Record Shows Every Active Table

The player record previously selected only the newest matching seat from at most ten seats, so multi-table players had only one Watch At Table action. The member table lookup now returns every unique readable active table in the club/funded-union scope, and the record stacks the existing painted watch controls for all of them.

Each click revalidates the selected table and player through the existing access RPC before opening its observer view. A departed table is removed individually. Existing refresh generations and duplicate-click protection remain in place. No engine or database replacement is required.

Regression coverage includes cash/MTT selection, more than ten seats, duplicate/deleted/other-club seats, funded union tables, refused access, departed seats and stale refresh responses. Mobile controls were rendered at 393px with the existing approved artwork; all three controls fit without overlap. Publication and live verification evidence are retained in the owning task checkpoint.
