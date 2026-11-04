# Owner closeout joins final runtime retirement

After canonical settlement, `owner_ack` previously returned without reaching the engine's final manager and lease retirement. The control now calls the existing endpoint for the same original operation, validates positive runtime retirement, and rereads the unchanged settlement receipt and exact serving identity. Settled reads and requests remain nonmutating; no financial, schema, or engine behavior changes.

The existing operation suite covers repeat ACKs, lost acknowledgements, false or mismatched proof, receipt and runtime drift, and the actual CLI intent/receipt artifact boundary. The new regression fails against the previous control. Live closure and final retirement require the owning operator's existing workflow and verification after protected merge.
