# MAIN discovery completes its own TCP close before strict qualification

The composed Linux qualification recorded the initial discovery connection in
CLOSE_WAIT and FIN_WAIT_1 at the strict zero-client census, before the proposal,
grant or Inspector command. The HTTP client's local close was not evidence that
MAIN had consumed its FIN and closed the peer descriptor.

The single fixed loopback discovery request now retains its readable half after
the complete response and sends FIN without destroying the stream. Discovery
resolves only after the peer's EOF and the local close. The existing absolute
deadline and one-second idle timeout remain in force. Fixed HTTP framing has a
4 KiB header bound and preserves the 16 KiB response-body bound; incomplete,
ambiguous, oversized or wrong-endpoint responses refuse without another socket.

The strict kernel qualification module, foreign-client refusal, ownership
predicates, one-shot grant, Inspector transport and no-retry policy are unchanged.
The native fixture counts the new request through the actual socket write and
keeps its existing one-discovery/zero-after-grant assertions.

A real loopback half-close regression fails on the old discovery function because
it resolves while the fixture deliberately holds the peer open, then passes with
the correction. Framing, premature close, timeout and absolute-deadline cases are
covered in the existing enforced socket-qualification test file. Local Mac checks
do not substitute for the required composed Linux/pinned-Node qualification or
prove production retirement, activation, seal or thaw.
