# Net recorded unregistration refunds in the Horse census

The frozen November 10 census counted every recorded tournament funding
receipt as cost. A registration that was later unregistered keeps its entry
receipt and receives a separate refund, so the published tournament return on
cost overstated cost wherever refunded registrations existed.

The census now accepts an explicit private refund acquisition with
`--refund-evidence`. It nets a refund only against the recorded funding it
reverses, after checking the cutoff, the cached tournament scope, the funding
receipt of every unregistered registration and agreement between the
unregistration receipts and the separate refund tranches. It refuses ticket
returns, a refund against a tariff estimate, a refund above recorded funding
and any other refund source on a completed tournament. Gross recorded cost,
refunds and net cost are reported separately.

Without that evidence the report states that refund coverage is unverified and
keeps gross cost. No refund is inferred. This is offline reporting source; it
reads no payment system, changes no payment and certifies no wallet movement.
