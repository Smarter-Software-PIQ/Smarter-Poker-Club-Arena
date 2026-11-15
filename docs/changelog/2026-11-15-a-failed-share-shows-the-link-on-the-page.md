# A failed share shows the link on the page

2026-11-15. Found during the signed-in check of the share flows on production.

When the share sheet, the Clipboard API and the selection copy all refuse,
`src/lib/share.ts` answers `failed` and the caller owes the player the link so
it can be copied by hand. Tournament Details and the Referral Dashboard put it
in an error toast ("Could Not Share. Copy This Link: <url>"). The Toast layer
sanitises error text (`src/utils/safeErrorMessage.ts`: a URL reads as a
machine fingerprint), so on production the player read "Could Not Share. Copy
This Link. Please Try Again." with no link anywhere.

`src/components/common/ShareLinkFallback.tsx` now prints the link on the page
in a read-only field, selected as it appears, with "Copy Is Blocked Here. The
Tournament Link Is Selected, Copy It By Hand." Both surfaces use it.

Law: `tests/a-failed-share-shows-the-link-on-the-page.law.test.tsx` (no error
toast may carry a link for copying; the fallback renders, says so and selects).
