This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Booking refresh recovery

The booking flow saves a versioned draft to `sessionStorage` under
`elysium:booking-session:v1`. Inputs, navigation, calendar month, and dialog changes
renew a 20-minute inactivity deadline. Refreshing restores the existing deadline;
it does not extend it. Expiry clears the draft and returns to the welcome screen,
including when a suspended tab becomes active again.

Restoration preserves partial inputs, selected times, the open info/terms dialog,
and the completed demo confirmation reference. Validation messages are recalculated.
Terms acceptance exists only in memory and is never saved. Every refresh clears
acceptance, including for drafts saved by older versions, and returns an unfinished
payment to review so the user must accept again. During the current page session,
changing booking details also invalidates acceptance. `BOOKING_TERMS_VERSION` in
`lib/booking-session.ts` should be bumped whenever the displayed terms change.
Completed confirmations remain viewable after refresh. Starting another booking
clears the saved draft.

Storage is tab-scoped and may be disabled by the browser; the form remains usable
and displays a recovery warning if storage fails. This is frontend draft recovery,
not authentication, a reservation, or proof of payment. Real availability and
payment status must be verified by a backend when those features are added.

Run `npm test` with Node.js 22.18+ for the session restoration regression tests.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
