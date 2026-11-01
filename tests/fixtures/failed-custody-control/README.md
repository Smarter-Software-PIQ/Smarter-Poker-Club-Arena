# Original failed-custody control fixture

`engine-release-transaction.raw.txt` is the immutable source blob from protected revision `3e3c6d4752cd587fad0db521ebd262f1b485514c`, path `server/scripts/engine-release-transaction.sh`. It is read and hashed by the historical source-reader test; it is never executed or installed.

SHA-256: `3b3c60aef43e521d886a6de04b0e9022e66fc66d6af5822f2b56af0a11214c39`. Size: 186237 bytes. The existing production reader identity and its 64 KiB common / 512 KiB purpose-specific limits remain unchanged.

The fixture retains the original loaded control while the maintained engine template evolves. Using the current template in this historical test made unrelated client checks fail after the next engine change. This data fixture does not restore or supply an engine publisher.
