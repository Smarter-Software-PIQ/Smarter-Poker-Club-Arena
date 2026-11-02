# Bounded schema-catalogue read deadline

Capture23 passed native snapshot transport but the catalogue driver read timed
out at5000ms, before any fixture build or full restore. Its client deadline
matched the server's five-second statement deadline, leaving no allowance for
the cancellation or completed payload to cross the connection.

The read-only capture client now allows the existing five-second server budget
plus five seconds of bounded response headroom. The server statement limit
remains five seconds, lock limit one second, absolute capture deadline45seconds
and dump/finalization limits unchanged. There is no retry or server/global
configuration change. The canonical catalogue query and encoding are unchanged;
native analysis disproved the proposed materialization optimization.

Native PostgreSQL17 receives actual57014 cancellation at the five-second server
limit, then rolls back and successfully reads through the same connection. This
does not claim production catalogue completion or a deterministic local replay
of the earlier network timeout. Full captured-schema and15-case verification
remain mandatory through the changed protected operation.
