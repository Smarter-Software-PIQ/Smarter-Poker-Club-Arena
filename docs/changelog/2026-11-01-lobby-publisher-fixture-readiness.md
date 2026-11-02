# Complete The Cashier Fixture's Initial Read Before Its Assertion

The lobby interaction release's publisher 41385630951 failed its client-test shard8 on one unchanged cashier test: the first cold Agent Wallet fixture remained at Loading Members when its default recipient lookup expired. The identical cashier/test/read-hook sources passed all33 cases in publisher41383720619. The failed case also passes alone locally, so no financial product regression is established.

Wrap only that first fixture's open operation in asynchronous React act so its owned immediate mocked balance and roster read chain is flushed before looking for Kingfish. Preserve the actual modal, every RPC and all zero-funded-wallet/no-send assertions. No timeout, test retry, product money behavior or other case changes.

This is a directly connected publication gate repair. The failed publication remains recorded; protected delivery and the complete scoped live audit are still required.
