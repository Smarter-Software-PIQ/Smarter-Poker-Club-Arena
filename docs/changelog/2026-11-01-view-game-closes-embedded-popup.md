# View Game Reveals The Selected Table

View Game prepared and selected the cash table, but an embedded club lobby stayed mounted and left its body-level game popup covering the table. Close that popup after successful preparation before navigating. Routed lobbies keep their existing unmount behavior to preserve query-string navigation ordering. Failed preparation keeps the popup open and reports the existing warning; no join, buy-in or waitlist operation is added.

Regression coverage mounts the actual club lobby persistently across navigation, opens its real card, and verifies that successful signed-in and signed-out entry removes the popup while a preparation refusal keeps it open. Both success cases fail against the prior source because the dialog remains mounted.
