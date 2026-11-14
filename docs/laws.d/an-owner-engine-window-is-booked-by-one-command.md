# tests/an-owner-engine-window-is-booked-by-one-command.law.test.ts

Booking an off-cycle owner engine window is one command, `scripts/release/book-owner-engine-window.py`: it validates the booking, writes every release control, document and test edit together or none of them, and reports the native floor suite's result. The law runs it against disposable copies of the release controls (book, book again, every refusal, a failing suite) and never writes the checkout.
