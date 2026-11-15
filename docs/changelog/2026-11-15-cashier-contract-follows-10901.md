# The cashier contract follows #10901 (2026-11-15)

Main went red on the cashier successor law at 02:31Z. #10901 merged on a base from before the law existed and installed `20261115020001` (recorded statement md5 `341fe86f…`, guard on the previous pin `553be2e8…`), which moved `fn_cashier_history_feed` to `6c73793f…`. That is the feed's fourth move in one evening without the contract. The law caught it on main, which is what it is for.

The contract now names `20261115020001` and pins the installed body. No check is weakened. The full contract ran read-only against production to its last line at 2026-11-15T02:54:04Z.

From here on a PR that changes a pinned cashier function fails its own checks until it names itself in the contract.
