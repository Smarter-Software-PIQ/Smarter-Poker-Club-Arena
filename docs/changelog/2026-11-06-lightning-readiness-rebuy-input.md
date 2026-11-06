# Lightning readiness recognizes the authorized rebuy input

The November 1 maximum-rebuy input policy introduced horse identification in
`fn_lightning_auto_rebuy`. The rollout readiness scan treated every occurrence
of that identification as unequal player treatment, so its `law_10_5` invariant
failed even though the existing input-device policy was installed correctly.

The readiness function now recognizes only the exact reviewed function
signature and complete definition, owned by postgres and executable by
service_role with no PUBLIC, authenticated or anon execute grant. Unknown
functions, overloads, changed bodies, security settings and unsafe permissions
still fail the invariant. Every other readiness condition and the readiness
function's authority remain unchanged. No gameplay or financial write changes.

The existing Phase 13 native qualification invokes the new regression. It loads
the exact production readiness preimage and maintained rebuy source into an
isolated PostgreSQL catalog, reproduces the false invariant, applies the actual
migration, and tests body drift, overloads and permissions. Missing unrelated
evidence still refuses a GO verdict. Publication requires protected merge,
exact migration installation/readback and authenticated live browser proof.
