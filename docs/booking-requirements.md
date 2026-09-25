# Booking backend — agreed scope

Implemented September 24, 2026. Updated to use Stripe for deposits through Apple Pay and Cash App Pay. `database-plan.md`, if present, describes a separate proposed database evolution; it is not required by this implementation.

## Schedule

- New York local time (`America/New_York`, including DST), open 24/7.
- Control room $50/hour, full studio $100/hour; one shared physical studio.
- Two-hour minimum, 23-hour maximum from the selected start, in half-hour increments. The limit also applies to rescheduling and extensions.
- Select a start on the chosen New York date, then an end up to 23 elapsed hours later (possibly the next day), subject to occupancy and cleanup. The end selector is disabled until a start is chosen; changing the start clears the end.
- Calendar dates are selectable only when a future two-hour session fits, including overnight sessions and cleanup. Month availability refreshes every 30 seconds while visible, on focus, and on return from a background tab; selecting a date rechecks availability before navigation.
- Start times up to three calendar months ahead, including today; past starts rejected.
- A minimum 15-minute cleanup gap. Because selectable starts are on half hours, the next selectable start after an aligned end is normally 30 minutes later.
- Charge elapsed session hours across DST, with explicit EDT/EST start options.
- Original and proposed times both stay reserved during change review. Overlaps within one booking merge into a multirange; different bookings cannot overlap at the database level.

## Requests and deposit payments

- Initial deposit: 50% of the server-calculated total, collected through Stripe in USD.
- Accepting terms reveals Apple Pay where supported and Cash App Pay. Choosing a wallet reserves the time and starts checkout, without a separate submission or payment-reporting step.
- Unpaid checkout holds expire after 15 minutes (or the session start, if sooner). Paid requests keep the approval deadline: 48 hours after submission or session start, whichever is earlier.
- Stripe records deposits automatically through signed webhooks, with server-side retrieval to reconcile returning customers. Browser reports cannot mark deposits paid; staff cannot manually record a deposit.
- Retries reuse the same PaymentIntent; duplicate success notifications cannot duplicate receipts or email jobs. Validate the booking, intent, amount, currency and test/live mode before recording payment.
- Studio approval remains required. Payment alone does not confirm a booking.
- Late payments cannot revive released time. Declines, expiry, studio cancellation, and payments arriving after artist cancellation produce a refund obligation.
- Stripe fees are handled through the merchant account; no invented customer surcharge is added.
- Balance and refunds remain handled by the studio. Issue deposit refunds through Stripe first, then record the cumulative refunded amount. Staff recording changes bookkeeping only; it never moves funds.

## Guest access

No artist accounts. Contact details live on the booking. A private capability link is emailed on request/updates, valid until the current approved end time. Tokens are purpose-bound, generated using a server secret and per-booking nonce, and stored as hashes. They appear in URL fragments, then travel to the API through Authorization headers. No third-party analytics on private pages. Staff get a separate role-bound link, valid for 90 days after session end for reconciliation.

Recovery returns a generic response and emails existing active links to the booking email only. It does not revoke an artist's working link just because someone submits their address. The operator can rotate a booking's links using the local command.

## Cancellation, changes, completion

- Artist cancellation is refundable only strictly more than 24 hours before start.
- At exactly 24 hours and later, the deposit is nonrefundable. Bookings made within 24 hours are immediately nonrefundable.
- Once the cutoff is reached, moving the reservation does not restore refundability.
- Cancellation after session start goes through staff; an artist cannot erase a session already in progress.
- Changes require approval. Preserve original rates for both room options and the original deposit amount.
- During a session, artists may extend the end only. Approval must happen before the original end, and the additional time plus cleanup must fit.
- A pending change expires at the earlier relevant start (before a session), or original end (during a session), bounded by 48 hours.
- The artist link expiry follows an approved new end time.
- Completion is a manual staff action after the session ends. A shorter completed session whose total is less than receipts generates a refund obligation. Never automatically refund because a clock reached the scheduled end.

## Integrations and remaining launch settings

PostgreSQL is authoritative. Google Calendar is an outbound copy with stable IDs, pending/confirmed events and a separate pending-change event. Events include the cleanup buffer. Calendar failures do not roll back bookings; durable jobs retry. Calendar edits do not change availability.

Email and calendar jobs are inserted in the same transaction as the booking update. Deploy a scheduled worker. Local test emails can be written to ignored files; production uses Resend. Staff UI is a per-booking action page, not an administration dashboard.

Tax classification and rate still require business confirmation. Live creation is disabled until `PRICING_CONFIRMED=true`. The example zero tax rate is a test value, not a tax determination. Stripe keys, webhook endpoint, Apple Pay domain registration, provider accounts, sending domain, staff address, Google OAuth connection, existing-booking import, and production database/hosting are launch setup.
