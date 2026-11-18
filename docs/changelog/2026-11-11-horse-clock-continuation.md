# Horse clocks survive the live continuation lane

Fresh production verification of #10346 found accepted tournament actions without
their private clock receipts. The controller attached the receipt correctly, but
the live continuation lane cloned the action record at enqueue and again before
dispatch. Those clones lost the object identity used by the private receipt map.

The lane now carries existing private receipt metadata to each live clone. Event
payloads and persisted continuation bytes remain unchanged. Serialized recovery
events without receipts remain unknown; no timestamps are reconstructed. Action
legality, strategy thresholds, check/fold eligibility and shove timing are unchanged.

Focused coverage exercises the real controller, retained continuation batch and
history receipt consumer, including serialization and fenced or failed delivery.
Protected engine publication and fresh natural production verification are required
before this correction is considered delivered.
