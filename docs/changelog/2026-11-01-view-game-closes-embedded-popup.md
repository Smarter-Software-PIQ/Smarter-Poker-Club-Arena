# View Game Reveals The Selected Table

View Game prepared and selected the cash table, but an embedded club lobby stayed mounted and left its body-level game popup covering the table. Close that popup after successful preparation before navigating. Routed lobbies keep their existing unmount behavior to preserve query-string navigation ordering. Failed preparation keeps the popup open and reports the existing warning; no join, buy-in or waitlist operation is added.

Regression coverage mounts the actual club lobby persistently across navigation, opens its real card, and verifies that successful signed-in and signed-out entry removes the popup while a preparation refusal keeps it open. Both success cases fail against the prior source because the dialog remains mounted.

The required client suite also exposed a pre-existing recovery-reader fixture defect after integration with current main: the fixture copied the current transaction script but expected the digest of a historical transaction. Compare the reader result with the actual fixture bytes and explicitly verify that a foreign digest remains unqualified and cannot query the journal. The runtime reader, immutable historical digest and release behavior are unchanged.
