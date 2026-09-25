CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  request_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  email text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_email ON bookings(email);
CREATE TABLE IF NOT EXISTS studio_occupancy (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id),
  occupied tstzmultirange NOT NULL,
  EXCLUDE USING gist (occupied WITH &&)
);
CREATE TABLE IF NOT EXISTS booking_events (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  version integer NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS booking_jobs (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  version integer NOT NULL,
  kind text NOT NULL CHECK(kind IN ('email_guest', 'email_staff', 'calendar')),
  message text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  UNIQUE(booking_id, version, kind)
);
CREATE INDEX IF NOT EXISTS booking_jobs_pending ON booking_jobs(available_at) WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS booking_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
