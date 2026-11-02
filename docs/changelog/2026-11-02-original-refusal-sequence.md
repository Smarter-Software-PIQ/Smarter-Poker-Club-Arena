# Preserve the complete original refusal sequence

The original-invocation reader exported only the first filtered refusal. The production observation identified a seal identity probe that its caller explicitly handled, so it did not establish why the transaction later exited. Dropping later rows prevented the bounded read from answering that distinction.

The same exact original operation and immutable-source binding now export every complete filtered refusal, in chronological order, within the existing16-row/8KiB/five-second bounds. Known literals retain source file, line and digest; unclassified entries retain only time and message digest. The projection explicitly keeps transactionExitCause UNKNOWN. No observed probe or diagnostic record grants retry or custody authority. Historical v1 validation remains supported; new observations use v2.

Twelve focused cases pass, including a handled seal probe followed by a later refusal and private unclassified text. The maintained183-case wrapper passes under its unchanged15-second child limit. Protected delivery and the actual production sequence read remain required. This is a bounded diagnostic prerequisite for engine recovery, not engine activation or Phase2 completion.
