# The Cashier amount field is a 44px touch target

The production Cashier certification (`production-cashier.spec.ts`, "opens the
legacy bookmark in the single Cashier...") has failed since #12044 moved its
phone check onto the Send Out dialog: the Amount field measured 30.3px tall
against the 44px touch-target floor.

Cause: `.console input.entryInput, .console select.entrySelect` in
`src/pages/CashierTradePage.module.css` filled the painted plate
(`height: 100%; min-height: 0`), and on a phone the plate is 140/274 of a row
about 66px tall, so the field was about 34px in the dialog and 30px on the
narrower live console.

Fix: the field keeps `min-height: 44px`. The plate is a centring flex row and
the field is transparent and borderless, so its text centre does not move
(168.76px before and after in the render) and the 393px and 375px renders
are pixel-identical before and after. The same floor already sat on
`.entryRow select.walletSelect`. Pinned by
`tests/unit/cashierAmountFieldTouchTarget.test.ts`.
