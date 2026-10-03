-- BR: move login throttling out of process memory so it survives restarts and
-- is shared by every instance of the API.
--
-- The counters used to live in a Map inside the Node process. That was sound
-- when the API ran as a single long-lived process on the shop's own PC, but it
-- stops being true the moment the API is deployed for more than one instance:
-- each instance kept its own Map, so an attacker got a fresh set of attempts per
-- instance, and a restart wiped the record of a grinding attack entirely. With
-- 4-digit PINs, an API exposed to the internet behind a Map-based limiter is
-- effectively unprotected.
--
-- This table is the shared store: any instance sees any failure, and the state
-- outlives the process.
--
-- The counter keys are opaque strings built by the application ("id:1", "ip:x").
-- They are deliberately not parsed here so the storage stays independent of how
-- the limiter decides to identify a caller.

CREATE TABLE IF NOT EXISTS jaribio_la_ingia (
  -- Opaque caller key. Text rather than an id type because it carries both
  -- account ids and IP addresses.
  kituo           text PRIMARY KEY,

  -- Failures counted since bila_start. Once the window lapses, the next failure
  -- restarts the count from one instead of resuming an old tally.
  majaribio        integer     NOT NULL DEFAULT 0,
  bila_start      timestamptz NOT NULL DEFAULT now(),

  -- Zero (the default) means "not locked". Storing an explicit timestamp rather
  -- than a boolean lets the lock expire without a sweeper having to run on a
  -- schedule.
  hadi_kufungwa    timestamptz NOT NULL DEFAULT to_timestamp(0),

  iliyosasishwa    timestamptz NOT NULL DEFAULT now()
);

-- Supports the periodic cleanup of counters that expired long ago. Without this
-- the table grows by one row per distinct caller for ever.
CREATE INDEX IF NOT EXISTS idx_jaribio_la_ingia_hadi_kufungwa
  ON jaribio_la_ingia (hadi_kufungwa);
