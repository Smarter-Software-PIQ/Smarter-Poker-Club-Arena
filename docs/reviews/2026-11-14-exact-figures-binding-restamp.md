# Source-binding restamp review: exact-figures display (PR #10797)

Owner authorization 2026-11-14 01:20 Chicago: update the source bindings to bind the reviewed presentation changes, preserving every financial assertion and safeguard.

Base: origin/main 74f7a5a45. Every hunk below changes a DISPLAYED string (or a test title/comment). No fixture row, RPC argument, wallet amount, ledger assertion, scope/RLS guard or money-movement expectation changes.

## tests/cashier-weekly-statements.test.tsx

previous sha256 dc2c3cb202c4119f3828f4ac68865e31e8f52874cdecb154bf8832491202bac2
current  sha256 9d96d8baeca3249f300077b7cdc5e7c0fa010a12bcde4f8b93f145140484ac1a

```diff
-    // #ClubArenaConsole forward display (launch audit 2026-10-09, P-09 / R-08):
-    // the reader keeps 40.05 / 100.25 / 60.20 exactly; the rows print whole
-    // chips rounded down and never a decimal point.
-    expect(await within(panel).findByText('Retained 40 Chips')).not.toHaveClass(
+    // Exact figures (Dan 2026-11-13): the rows print 40.05 / 100.25 / 60.20
+    // exactly as the reader keeps them, never rounded down.
+    expect(await within(panel).findByText('Retained 40.05 Chips')).not.toHaveClass(
-    expect(within(panel).getByText(/Rake Funding 100 Chips/)).toHaveTextContent(
-      'Paid By Club 60 Chips'
+    expect(within(panel).getByText(/Rake Funding 100.25 Chips/)).toHaveTextContent(
+      'Paid By Club 60.20 Chips'
-    expect(panel).not.toHaveTextContent(/999|888|777|\+40|40\.05|100\.25|60\.20/);
+    expect(panel).not.toHaveTextContent(/999|888|777|\+40/);
-    expect(await within(panel).findByText('Retained 40 Chips')).toBeInTheDocument();
+    expect(await within(panel).findByText('Retained 40.05 Chips')).toBeInTheDocument();
-    expect(screen.queryByText('Retained 40 Chips')).not.toBeInTheDocument();
+    expect(screen.queryByText('Retained 40.05 Chips')).not.toBeInTheDocument();
-    expect(within(renewedPanel).queryByText('Retained 40 Chips')).not.toBeInTheDocument();
+    expect(within(renewedPanel).queryByText('Retained 40.05 Chips')).not.toBeInTheDocument();
-    await within(first).findByText('Retained 40 Chips');
+    await within(first).findByText('Retained 40.05 Chips');
-    expect(screen.queryByText('Retained 40 Chips')).not.toBeInTheDocument();
+    expect(screen.queryByText('Retained 40.05 Chips')).not.toBeInTheDocument();
-    expect(next).not.toHaveTextContent('Retained 40 Chips');
+    expect(next).not.toHaveTextContent('Retained 40.05 Chips');
```

## tests/components/WeeklyAccountingWorkspace.test.tsx

previous sha256 3fa2ec057866093383ec05539ac3a60de8cec52abfee780d2491ead8894f5be7
current  sha256 ef30a660badbcb434bb9a07afa7517cf7b5ee83e823118d95b5d528f344e5c23

```diff
-    expect(await screen.findByText('100 Chips')).toBeInTheDocument();
-    expect(screen.getByText('60 Chips')).toBeInTheDocument();
-    expect(screen.getByText('40 Chips')).toBeInTheDocument();
+    expect(await screen.findByText('100.25 Chips')).toBeInTheDocument();
+    expect(screen.getByText('60.20 Chips')).toBeInTheDocument();
+    expect(screen.getByText('40.05 Chips')).toBeInTheDocument();
-    expect(screen.queryByText('100 Chips')).not.toBeInTheDocument();
+    expect(screen.queryByText('100.25 Chips')).not.toBeInTheDocument();
-    expect(screen.queryByText('100 Chips')).not.toBeInTheDocument();
+    expect(screen.queryByText('100.25 Chips')).not.toBeInTheDocument();
-    expect(screen.queryByText('100 Chips')).not.toBeInTheDocument();
+    expect(screen.queryByText('100.25 Chips')).not.toBeInTheDocument();
-    expect(await screen.findByText('100 Chips')).toBeInTheDocument();
+    expect(await screen.findByText('100.25 Chips')).toBeInTheDocument();
-    await screen.findByText('100 Chips');
+    await screen.findByText('100.25 Chips');
-    expect(screen.queryByText('100 Chips')).not.toBeInTheDocument();
+    expect(screen.queryByText('100.25 Chips')).not.toBeInTheDocument();
```

## tests/credit-admin-data.test.ts

previous sha256 4a0314b6d67b26952d6a7836fffebe9239349c53474f4ff034f6e7eff2049bcf
current  sha256 47462de7312c7f45a6caabeff0ce425a594f80ed73ffba72e2de8e1f62eae43f

```diff
-  it('keeps exact cents in data while compacting forward-facing chip display', () => {
+  it('keeps exact cents in data while printing the exact chip figure', () => {
-    expect(creditAdminMoney(100.25)).toBe('100');
-    expect(creditAdminMoney(1290.99)).toBe('1.2K');
+    expect(creditAdminMoney(100.25)).toBe('100.25');
+    expect(creditAdminMoney(1290.99)).toBe('1,290.99');
```

## tests/credit-admin-panel-scope.test.tsx

previous sha256 1f6bc078af417542917561e2667dde60fff236eaaffee07f7591170f7bfc42b4
current  sha256 a6919769f6399b1439d28ccf371955a0772761ba92b815205670bb9f11aca1ac

```diff
-  it('keeps exact credit cents in the write while the confirmation stays decimal-free', async () => {
+  it('keeps exact credit cents in the write and in the confirmation', async () => {
-    expect(mocks.toast.success).toHaveBeenCalledWith('Credit limit updated to 200');
-    expect(mocks.toast.success).not.toHaveBeenCalledWith(expect.stringContaining('200.25'));
+    expect(mocks.toast.success).toHaveBeenCalledWith('Credit limit updated to 200.25');
```

## tests/credit-request-widget-scope.test.tsx

previous sha256 45ad84f004fe5fd39fcb8affa7a6c0f16c5782335966f4c01728305de8cd126d
current  sha256 6442b5280dcd6a2f726414fbbf26cc6eeee74ef93d9acd378c07539fc4df5330

```diff
-    expect(mocks.toast.success).toHaveBeenCalledWith('Credit limit updated to 200');
+    expect(mocks.toast.success).toHaveBeenCalledWith('Credit limit updated to 200.25');
```

## tests/unit/ClubWeeklyAccountingReader.test.ts

previous sha256 6be8e7def307a8363525ac7eb3600674f5d35f9524304cdd9770e77ab0c45856
current  sha256 46ac23883e61d38e4b3a3b4289d35f0bad1a5153b1292500e98af305a49f7063

```diff
-    expect(formatWeeklyChipsForDisplay(rows[0].retainedByClub)).toBe('Under 1 Chip Owed');
+    expect(formatWeeklyChipsForDisplay(rows[0].retainedByClub)).toBe('-0.95 Chips');
-    expect(formatWeeklyChipsForDisplay(rows[0].retainedByClub)).toBe('9.9B Chips');
+    expect(formatWeeklyChipsForDisplay(rows[0].retainedByClub)).toBe('9,999,999,999.99 Chips');
```

