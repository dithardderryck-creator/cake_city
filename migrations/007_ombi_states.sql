-- 007_ombi_states.sql
-- The request/directive state machine needs its states before anything can
-- reference them.
--
-- This file exists on its own for one reason: PostgreSQL will not let a
-- transaction use an enum value in the same transaction that adds it. The
-- additions have to commit first, and the backfill that rewrites the old
-- 'fungua' and 'imefanyika' rows onto the new vocabulary has to be the
-- transaction after that. The migration runner wraps each file in its own
-- transaction, so that boundary is a file boundary.
--
-- The old values are kept in the type rather than dropped. 'fungua' and
-- 'imefanyika' stop being used, but removing them from a live enum means
-- recreating the type and every column that uses it, which is a lot of risk to
-- take to tidy up two labels that nothing reads.

-- A request and a directive are the same record with opposite intent, so they
-- share one state machine rather than becoming two features that drift apart.
--
--   ombi     (asking)     imetumwa -> inasubiri -> imeidhinishwa -> imekamilika
--                                   \-> imekataa
--                                   \-> inahitaji -> imetumwa
--
--   direktive (instructing) imeanzishwa -> limekubaliwa -> inaendelea -> imekamilika
--
-- imeghairi is terminal and reachable from anything that has not finished.
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imeandikwa';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imetumwa';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'inasubiri';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imeidhinishwa';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imekataa';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'inahitaji';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imeanzishwa';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'limekubaliwa';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'inaendelea';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imekamilika';
ALTER TYPE hali_ombi ADD VALUE IF NOT EXISTS 'imeghairi';

-- CREATE TYPE has no IF NOT EXISTS in Postgres, so re-running this file is
-- caught by hand rather than by the parser. The whole runner is idempotent, so
-- this only matters if someone replays one file by hand.
DO $$ BEGIN
  CREATE TYPE aina_ukumbusho_kazi AS ENUM ('ombi', 'direktive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kipendeleo_ukumbusho_kazi AS ENUM ('chakati', 'kawaida', 'haraka');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
