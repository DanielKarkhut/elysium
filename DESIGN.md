# Typography

Heading:
- Alien Robot
- 48px
- 600

Body:
- Alien Robot
- Varies between 12px to 28px
- 400

# Colors

Background: #F7F7F7
Primary: #111111
Secondary text: #777777
Border: #E5E5E5

# Radius

Button: 23px
Card: 16px
Day bubble: 9999px

# Spacing

Page padding desktop: not sure, you decide
Page padding mobile: not sure, you decide

# Booking screen references

Use `docs/design/screens/01-landing.png` through `08-confirmation.png` as the visual source of truth. Screens 04 and 05 show the direct start/end selection screen after the calendar: “Booking starts on”, the selected date, then “Book from / To” with two square time selectors. The end selector stays disabled and gray until a start is selected. There are no availability-range bubbles or separate end-date controls.

Start times belong to the selected New York calendar date. Sessions last 2–23 elapsed hours in half-hour increments, including overnight when available. End options run from two hours after the chosen start through 23 hours after it, shortened by existing occupancy and cleanup. Changing the start clears the end selection. Preserve live calendar navigation, New York time guidance, and real availability.

The review and booking-status screens reuse the reference summary hierarchy. Accepting terms reveals Stripe payment buttons for Apple Pay (where supported) and Cash App Pay directly on the review screen. Deposit receipt is automatic; studio approval remains required. Show “Requested” while pending and “Booked” only once confirmed. Display real prices, the current cancellation terms, and operational instructions. Booking-link recovery is available through Info on the landing screen.
