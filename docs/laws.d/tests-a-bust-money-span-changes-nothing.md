# tests/a-bust-money-span-changes-nothing.law.test.ts

The timing spans in the knockout door and the bounty payer (20261114190106) change nothing a caller can observe: deleting every `-- @bust-money-span` line restores the exact bodies production ran (prosrc md5 4ec5bce3... and bc621ffb...), no span leaves FOUND or ROW_COUNT stale for a later statement, none sits inside the lane's lock block, and the helper swallows every error, writes only inside its 48-hour window and row cap, and its log has no foreign key. Native proof: scripts/ci/test-bust-money-spans-native.sh (PG17 scratch cluster).
