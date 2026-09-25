-- The application uses a trusted, server-only PostgreSQL connection. No browser
-- or Supabase Data API role should be able to read these tables directly.
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bookings, studio_occupancy, booking_events, booking_jobs, booking_rate_limits FROM PUBLIC;
-- No public RLS policies: deny by default. Owner connections used by the server
-- retain access. Configure a restricted server role explicitly before production.
