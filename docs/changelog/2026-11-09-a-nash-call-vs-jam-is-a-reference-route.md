# A Nash Call Vs A Lone Jam Is A Reference Route (2026-11-09)

Release bff6eed3 (sealed 2026-11-09 19:41Z) shipped Nash push/fold V2 (#10010):
every hold'em seat facing a lone open-jam at 20bb or less calls or folds from
the solved table's caller side, and tournament attribution stamps that
decision on the chart_bb_defend route. The route gate in
HorsePhase6Attribution still admitted only the sb_push chart's shape (big
blind against a small-blind jam, one opponent), so every other seat's receipt
was refused as route_gate and the engine folded the horse on the fallback.

Measured on the serving engine from boot (19:35Z) to 19:51Z: 3,843 fallback
folds in 730 of 1,788 NLH tournament hands, receipts horse_decision_refused_isolated
and nash_call_vs_jam tracking one for one; zero fallback actions on the
release before. Example hand c78015dc-c192-46c0-b8ec-a33adea0e8d4.

The fix admits exactly the public shape of the Nash return on that route: the
first and only raise is an all-in, nobody has called or limped, hero has not
acted, and the effective depth is inside the solved table. The hand class and
the call probability stay private. aNashCallVsJamIsAReferenceRoute.guard.test.ts
fails on the previous gate and passes on this one. No strategy changes.
