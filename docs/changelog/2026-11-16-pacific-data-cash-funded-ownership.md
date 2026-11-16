# Pacific Data cash follows original funded ownership

Legacy parent-table seat fallback could assign a child-funded player's cash fee to a different club. Pacific Data now resolves the original attribution, frozen cash source and funded admission in authority order while retaining the original unrounded contribution-weighted fee. Original UTC/Chicago writers and financial contracts remain intact.

Existing rake, attribution, cash-source and funded-admission callbacks observe the source atomically. Append-only authority receipts avoid shared receipt-row waits; later authority immediately suppresses earlier ownership. Cash source groups fold before game presence so an ownership correction cannot leave a phantom game. Tournament zero-fee entries remain visible.

Finite history checks cash amounts across original game/player keys; those controls prove conservation, never ownership. Positive-contributor Data hands are rebuilt from original rake IDs, rather than compared with the different UTC counter that includes zero-contribution clubs. A versioned seed receipt prevents an older basis from certifying new reads. Pending or unproved sources retain the existing explicit incomplete-window refusal.

Native PostgreSQL qualification retains the previous projection, access, fee, DST and source checks and exercises wrong unique ownership, raw fractions, signed game-presence correction, actual source hooks, original funded admissions, and concurrent duplicate observers.
