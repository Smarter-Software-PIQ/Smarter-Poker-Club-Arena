# Incident collection survives malformed health responses

The Phase 1 follow-up audit reproduced a remaining failure with a real local HTTP
server: malformed chunk framing raised `http.client.IncompleteRead`, which was
outside the explicit incident reader's health exception boundary. A broken health
response could therefore still prevent Docker and kernel evidence collection.

The existing incident boundary now handles HTTP protocol failures as unavailable
health with a null identity and the closed `io_unavailable` category. It never
exports the response text or treats unavailable identity as healthy. Ordinary
health-gated observations continue to refuse these failures.

The maintained native fixture exercises real malformed HTTP framing, ordinary
refusal, redaction and the connected remote entry with a malformed status line.
The framing regression failed before the source correction. It runs through
`tests/scopedRuntimeErrors.test.ts` in the existing client CI suite. Publication
uses protected main and the existing explicit read-only observation workflow;
no engine restart or runtime change is required.
