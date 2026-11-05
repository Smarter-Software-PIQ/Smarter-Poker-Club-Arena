# An Expired Owner Window No Longer Blocks Every Release

Every engine release since 12:45Z on 2026-11-05 (for example run 42049021165, target `8017564a`) refused before building an image with "activation floor refused: explicit later owner window expired; no alternate reset authorized". The same refusal stranded protected main on 2026-11-03 and earlier on 2026-11-05, and each time the only way out was a human merging a fresh dated window into `server/release/activation-floor.json`, or a hand cutover on the host.

Root cause: `engine-release-activation-floor.py` refused every fresh preparation and admission once an owner window marked `supersedesPhase1Schedule` had expired. Nothing renews those windows, so every lapse turned into a hard stop, unlike the 2026-10-30 rule that an expired floor is no floor.

Fix: an expired later owner window now hands fresh work back to the canonical Phase1 hourly cycle (or, with no Phase1 policy in the target, to the existing "expired floor is no floor" rule). The Phase1 cycle's own sealed :53 announcement / :55 cutover window and every seal check still apply. A live owner window still takes precedence, and entries already owned inside a window keep their exact record and recovery. The floor test now proves a lapsed window selects the routine cycle and creates no owner entry.
