# Isolated multi-owner schema restore

Ordinary postgres cannot create and assign the captured Admin and StorageAdmin
objects. The genuine managed library does not bypass ordinary ownership checks.
Plain PostgreSQL also refuses transferring an event trigger to non-superuser
postgres; those blocks require the provider's explicit managed creation path.

A fixed private original-Admin transaction uses a defaultless NOLOGIN creator
for ordinary objects, preserves every raw dump body and order, and selects the
ordinary managed postgres context only for its event-trigger blocks. The fixed
context planner records original/applied hashes. The creator must have zero
remaining dependencies before dropping; application role attributes, settings
and memberships must remain unchanged. Any failure rolls back all restoration.
No production role is promoted or given extra memberships.

Required native qualification runs both genuine managed event-owner paths and
reserved ordinary owners in a rollback-only probe before exporting the service
preimage. The full captured catalogue, roles, Auth facts and fifteen application
cases remain mandatory; no success is inferred from this source change.
