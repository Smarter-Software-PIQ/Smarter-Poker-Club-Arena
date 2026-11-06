# Registration Through Add-On And Live Purchase Count

Owner request: buy-ins and rebuys stay open until the actual 60-second add-on window ends. Nightly 10K previously rejected entry at its90-minute wall-clock limit while its last entry level had not finished.

The canonical database admission and rebuy predicates now use the persisted add-on end for add-on events, including pending hand drain. Capacity, finalized/terminal state, eligibility, duplicate receipts and accounting remain guarded. The serving engine retains its existing phase-start contract, so keeping admission open does not prevent it starting add-ons. Events without add-ons keep their configured limits. Lobby, details, HUD and purchase projections agree; the fast lobby RPC includes the required persisted fields.

After an atomic add-on receipt is committed, a private tournament purchase signal refreshes the break card's complete-field standings. Add-Ons Taken counts unique players with persisted add_on=true across all tables, including Horses. Reconnect rereads the count; unavailable reads or subscriptions show uncertainty. No polling or client-supplied increment is used.

Validation: isolated PostgreSQL reproduces early closure before the change and checks pending, drain, last second, exact expiry, finalized/terminal/capacity and non-add-on cases. The actual purchase insertion is checked after receipt proof; transaction rollback and private RLS are exercised in isolation without production chips. UI tests cover purchase events, duplicate notification, reconnect and failed reads. The real component rendered at393px and updated123 to124 after an event. Production installation and publication remain pending at source submission.
