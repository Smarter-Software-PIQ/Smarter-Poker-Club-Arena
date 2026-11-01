# Cash street decision and community card readiness

A lost state DELTA could leave the previous street's bets and action labels cached while an independently sequenced turn event supplied the new decision token. The actual TablePage then exposed Check/Call without a legal opening Bet. EngineStateClient now retains only the latest unmatched turn notification and requests its existing bounded RESYNC. It dispatches that notification only after the complete state carries the same action_context. It never retains or replays a player input. Normal matched events, duplicate sequencing and epoch resets keep their existing behavior.

Static community card faces now explicitly load eagerly, matching animated faces and CardImage's board contract. Hidden table faces therefore do not inherit lazy loading. Existing image-format and text fallbacks remain intact.

Regression evidence: old transport unit and isolated mounted browser fail; the browser observes 16 partial decision frames after one recorded DELTA is dropped without reordering any delivered frame. Fixed Chromium passes both normal BB call-to-flop/turn and dropped-state recovery cases, including actual loaded board images. Component regression fails before eager loading and passes afterward. Duplicate events, nonmatching recovery snapshots and disconnect/reconnect are covered. The browser cases run against this commit's existing CI build and synthetic recording; no production player, chip or service is used.

These reproduced defects do not establish the exact cause of Burls's historical Safari incident. Recorded submit aborts and missing-heartbeat evidence remain separate, and desktop browser qualification is not physical iPad or production adoption proof.
