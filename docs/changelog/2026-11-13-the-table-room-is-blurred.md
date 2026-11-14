# 2026-11-13 - The table room is blurred again

Dan: "MAKE THE BACK GROUND BLURY LIKE THEY WERE BEFORE, I DON'T LIKE THE
CURRENT FULL FEATURE SIDE EFFECTS."

## What changed before

The blur behind the table was never designed. `src/components/common/Table.css`
styled `.table-container` with data-table glass (`backdrop-filter: blur(12px)
saturate(1.3)`, a 2% white wash), and the gameplay container in TablePage
shares that class name, so the room behind the felt was blurred. #10763
(d2edf635f, 2026-11-13 20:06) namespaced the data-table wrapper to
`.data-table-container` to remove a seam above the transparent tournament dock,
which also removed the blur: the room showed at full detail.

## Fix

The same treatment on purpose, on its own layer: `.table-room-blur`, the first
child of `.table-page`, `position: absolute; inset: 0; z-index: 0`, under
`.table-container` (z-index 1), the header and every fixed control. Covering
the whole page keeps the blur continuous behind the tournament dock, so the
seam #10763 fixed does not return, and the felt, cards and controls are never
filtered. Pinned by `tests/the-table-room-is-blurred.law.test.ts`.
