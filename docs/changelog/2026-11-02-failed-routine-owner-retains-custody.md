# A failed routine owner keeps its original custody

The generic retirement added by #9244 let an owner check delete an expired reserved cycle after a durable failure and nonzero `systemctl is-enabled` results. Nonzero exits include unreadable unit state and bus errors. Expiry and failure do not prove cleanup or authorize removing the owner.

The correction removes the generic retirement calls and helper. It preserves the original cycle, failure and audit bytes. Unexpected nonempty or malformed `retiredRoutineCycles` history refuses admission and requires original custody reconciliation. The legitimate physical-path fixture corrections from #9244 remain unchanged. The separately qualified exact-owner resolver in #9231 retains its existing operator and full native proof requirements.

The existing law now invokes real seal subprocesses in private fixtures. Five methods cover 47 subprocess calls: enabled, disabled, unknown and errored native-state responses; foreign reservation refusal; original failed-owner replay refusal; nonempty or malformed retirement history with and without an active cycle; and unaffected absent or empty-history reads. The owner gate must make no native unit probe and leave the state, audit and original failure bytes unchanged.

Validation reproduced the defect using protected source `3634e37fa52db1c76de3028470c9328cc3d242f0` in isolation: a simulated systemd bus error with exit 1 returned `none`, removed the original cycle and wrote retirement history. The corrected five native tests pass. The maintained seal law and regression wrapper pass all 71 tests. Root TypeScript, 1,822 source bindings, formatting and diff checks pass. No production financial operation or release is exercised by these fixtures.

The read-only production audit at 2026-11-02T02:09:44.111993Z confirmed the original failed cycle remained reserved with its unchanged seal and failure receipt. This source correction still requires protected delivery; actual failed-owner resolution, engine activation and financial settlement retain their existing acceptance requirements.
