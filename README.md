# Elysium booking

Next.js booking application with PostgreSQL availability, guest management links, Stripe deposits through Apple Pay and Cash App Pay, studio approval, and durable email/Google Calendar jobs. No artist accounts.

Business rules: [docs/booking-requirements.md](docs/booking-requirements.md).

Proposed PostgreSQL/Supabase schema, staff sign-in, and migration roadmap: [docs/database-plan.md](docs/database-plan.md). This is a design plan; the runtime below describes the current implementation.

## Local setup

Requires Node 22.18+ and PostgreSQL 14+ (multiranges are required).

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` only if you do not already have one. Fill in your PostgreSQL connection and `APP_URL`.
3. Generate independent `BOOKING_SECRET` and `CRON_SECRET` values with `openssl rand -hex 32`. Keep them server-side. The booking secret must be at least 32 characters; changing it requires rotating stored booking links.
4. Keep `BOOKING_MODE=test`, `PRICING_CONFIRMED=false`, and `EMAIL_MODE=file` while developing. Configure matching Stripe test keys and a webhook secret as described below; test checkouts never charge real money.
5. Run `npm run db:migrate`, then `npm run dev`.
6. Run `npm run jobs:run` after booking mutations. Test email files appear in ignored `.local/mail/`; open the private staff link from a staff email to review the request. Missing Calendar configuration stays queued with a retry error; no fake successful delivery is recorded.

The runtime never migrates a database automatically. Migrations run on one connection under a lock and are tracked in `booking_migrations`. Use a direct/session-mode PostgreSQL URL. **The current worker uses a session advisory lock and is not compatible with a transaction-pooling URL.** Preserve TLS verification on hosted connections; do not use `rejectUnauthorized: false`.

Do not expose these tables to browser clients. RLS is enabled with no public policies. The supplied migration owner can run the server locally; production should use a dedicated trusted server role with the explicit table/sequence permissions and role-scoped policies it needs. The server, not a browser Supabase client, enforces guest/staff authorization. Never put database URLs or secrets in `NEXT_PUBLIC_*` variables.

## Staff workflow

The staff email link opens `/staff#<private-token>` for one reservation. Opening a link does not mutate anything.

- Stripe automatically records successful deposits. Review the paid request and approve it; unpaid requests cannot be approved.
- Review/approve or decline change requests. Original deposit and rate snapshots stay fixed.
- Record cumulative balance payments collected manually.
- Mark a confirmed session completed after its end. Any overpayment becomes a manual refund obligation.
- Issue deposit refunds in the Stripe Dashboard, then record the cumulative refunded total. For older manual payments, refund through the original provider.
- Declining a request or cancelling on behalf of the studio releases time and makes all recorded payments refundable.

Staff links last 90 days beyond the approved end for reconciliation. Guest links expire exactly at session end. Both are bearer credentials: keep them private. They use URL fragments so server URL logs do not receive them. Never log Authorization headers. Private pages set no-referrer and no-index metadata. Recovery emails preserve the existing token; unverified email submissions cannot revoke access.

Operator commands (use a trusted local terminal, not a public endpoint):

```sh
npm run studio -- list
npm run studio -- link <booking-uuid>
npm run studio -- rotate-links <booking-uuid>
npm run studio -- jobs
npm run studio -- import-blocks ./existing-sessions.json
npm run studio -- release-block <block-uuid>
```

Import existing future sessions or manual blocks before launch. Input is an array of `{ "id": "stable UUID", "start": "2026-10-01T10:00:00-04:00", "end": "2026-10-01T12:00:00-04:00", "note": "Existing session" }`. Stable IDs prevent duplicate imports, all entries are imported in one transaction, and conflicts roll back the batch. Blocks include the 15-minute cleanup buffer. Resolve overlapping old bookings before importing. This command imports schedule occupancy, not historical payment receipts. Use the same command for future manual bookings/closures.

## Production integration setup

Use separate development/production databases and secrets; test records must never be copied into live inventory.

### Stripe deposits

After terms acceptance, the review screen displays an Apple Pay button where supported and a Cash App Pay button. Choosing a wallet creates the reservation and starts payment; merely checking the terms does not reserve time. Apple Pay uses Stripe Express Checkout. Cash App Pay uses Stripe's QR flow on desktop and app redirect on mobile. There is no separate “request session” or “I sent the deposit” step.

1. Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET`. Both API keys must belong to the same Stripe account and mode. Use `sk_test_` / `pk_test_` with `BOOKING_MODE=test`; switch both to live keys for live bookings. Rebuild after changing the publishable key.
2. Enable **Cards / Apple Pay** and **Cash App Pay** in the [Stripe payment method settings](https://dashboard.stripe.com/settings/payment_methods). Cash App Pay requires a supported US merchant account and USD.
3. Serve over HTTPS and [register the checkout domain](https://docs.stripe.com/payments/payment-methods/pmd-registration) for Apple Pay in both test and live mode. For local wallet testing, use an HTTPS tunnel and set `APP_URL` to its origin. Apple Pay availability depends on the device, browser, wallet, and domain registration.
4. Configure `POST https://<your-domain>/api/stripe/webhook` to receive `payment_intent.succeeded`. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. Locally, `stripe listen --events payment_intent.succeeded --forward-to localhost:3000/api/stripe/webhook` prints a separate local signing secret.
5. Test successful, cancelled, failed and redirected payments in Stripe test mode. Confirm the deposit is recorded once and the session still awaits studio approval. Use a compatible Apple Pay device and the Cash App test approval flow; no live payment is needed.

Amounts are calculated on the server in USD cents. Signed webhooks or server-side Stripe retrieval are the only sources of payment truth. Repeated attempts reuse one intent. Unpaid checkout holds last 15 minutes; paid requests keep their original studio approval deadline. A delayed payment after cancellation/expiry never restores a released slot and is recorded as a refund obligation. Refunds and the remaining session balance are still handled by the studio. The integration adds optional fields to existing JSONB booking records; no database migration is required. Existing recorded manual deposits remain intact.

### Email

Configure a verified sending domain with Resend, then set `EMAIL_MODE=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and comma-separated `STAFF_EMAIL`. Disable click tracking for private management links. Emails include booking status, Stripe deposit status, and private links while valid. No email is sent from test file mode.

### Google Calendar

Use a dedicated studio calendar and a Google OAuth client with Calendar event read/write access. Obtain offline consent from the calendar owner and configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GOOGLE_CALENDAR_ID`. Never check tokens into Git. The integration refreshes access tokens server-side, uses deterministic event IDs, and never invites the artist or sends Google attendee notifications.

Sync is one-way. Existing calendar entries are not automatically imported: first review/export them to the block import format. After launch, changes must go through Elysium or its operator commands. Pending, confirmed, and pending-change events block time; cancellation/expiry removes the matching events. Keep an eye on `npm run studio -- jobs` for failed deliveries.

### Worker and deployment

`vercel.json` schedules the authenticated `GET /api/jobs` endpoint every minute. Configure `CRON_SECRET` and use a hosting plan supporting this cadence. On other hosts, invoke the endpoint with `Authorization: Bearer <CRON_SECRET>` every minute or schedule `npm run jobs:run` in a trusted environment. Never expose an unauthenticated worker endpoint.

The worker serializes deliveries using a session lock, retries failures with exponential backoff, and leaves failed jobs visible. Calendar jobs reconcile the latest state. Email delivery is at least once with Resend idempotency keys; retries beyond the provider's idempotency retention can duplicate an email. Run a regular operational check of outstanding refunds, approval deadlines, and delivery failures. Schedule expiry is also checked on booking APIs, so a delayed worker cannot create overlapping reservations.

Confirm tax treatment/rate with the business, set `BOOKING_TAX_BPS`, then `PRICING_CONFIRMED=true` and `BOOKING_MODE=live`. A basis point is 0.01%. No placeholder processing fee or customer surcharge is added; Stripe fees are handled through the merchant account. `BOOKING_TAX_BPS=0` is not a production recommendation.

Enable provider backups and alerting, configure the runtime DB role, connect email/calendar, import future reservations, and smoke-test live configuration before accepting real bookings. The code provides these integrations; creating accounts, authorizing Google, and deploying are separate setup steps.

## Verification

```sh
npm test
TEST_DATABASE_URL=postgresql://.../elysium_test npm test
npm run lint
npm run build
```

Without `TEST_DATABASE_URL`, PostgreSQL integration tests are explicitly skipped. With it, tests create and drop a unique schema in the supplied test database; never point them at production. They exercise concurrent reservations, database overlap constraints, cleanup buffers, Stripe deposit verification, duplicate webhooks, retry reuse, late-payment refunds, exact cancellation cutoffs, rescheduling, active-session extensions, refunds, expiry, private-link isolation, and idempotency. Pure tests cover DST and browser draft recovery.

## API and persistence

- `GET /api/availability?month=YYYY-MM`: dates with at least one future two-hour start, accounting for occupancy, cleanup, and overnight sessions. The calendar refreshes this list and rechecks a date before opening time selection.
- `GET /api/availability?day=YYYY-MM-DD`: available starts on the selected New York date and valid end options per start (`endsByStart`), without customer data. Sessions last 2–23 hours; occupancy and cleanup may shorten the choices. Quote/create/change operations recheck availability and the duration limit.
- `POST /api/quote`: validates a complete interval and returns a server price.
- `POST /api/bookings`: validates terms and the displayed total, reserves the time, creates/reuses a Stripe PaymentIntent for the server-calculated 50% deposit, and returns its client secret and the private management token. Request UUID and Stripe idempotency keys provide retry safety. An unpaid checkout expires after 15 minutes.
- `POST /api/payments`: resumes the existing deposit using the private guest token.
- `POST /api/stripe/webhook`: verifies Stripe signatures on the raw body and records successful deposits idempotently.
- `GET/POST /api/manage`: guest-scoped viewing and changes, with optimistic version checks. Reading also reconciles payment status with Stripe when a webhook has not arrived.
- `GET/POST /api/staff`: role-bound payment/approval actions for one booking.
- `POST /api/recover`: generic response; sends private links only to the supplied matching address. Rate limited.
- `GET /api/jobs`: authenticated scheduled worker.

All schedule writes serialize per shared studio and have a PostgreSQL GiST exclusion constraint as a second line of defense. A booking stores its contact/pricing/state snapshot in JSONB; occupancy, audit events, jobs, and rate limits are separate tables. This intentionally small schema can evolve through migrations.

Drafts use tab-scoped `sessionStorage` with a 20-minute inactivity expiry. Reload keeps inputs and the request key but clears terms acceptance and rechecks availability/prices. Once payment has started, the draft also retains the private checkout link so reloading resumes the reserved booking instead of reserving it again. Browser drafts are never authoritative reservations. Old demo receipts are ignored.
