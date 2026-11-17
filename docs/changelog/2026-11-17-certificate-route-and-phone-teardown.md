# Preserve table identity and projected phone teardown in release proof

The full production certificate exposed two verifier defects. Close Lobby
reconstructs the same table URL with the existing `name`, `stakes` and `code`
display hints. Compare its table route identity across every observed navigation,
retaining the origin, path, fragment and all navigation-intent parameters. Tests
reject a different table, tournament page, origin or watch intent.

The temporary WebKit projection also needs the same route-handler teardown as
the journey's two main contexts. Detach context projection callbacks immediately
before closing the phone so pending profile reads cannot report disposal as a
journey failure. The separate page-level production-write refusal remains armed
through closure. Assertions, account cleanup, deadlines and retries are unchanged.
