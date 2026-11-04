# Retained manager lease refusal evidence

The original EED checkpoint now reports the failed lease check site, phase, hashed manager identity, and bounded lifecycle/deadline predicates through its existing refusal detail. Both original lease predicates and all mutation gates remain unchanged. Actual historical-owner cases require expired running, stopped, and teardown managers to refuse before any table checkpoint; a final-join expiry also names its phase. This supplies diagnosis, not authority to renew or accept an expired manager.
