-- Make aina_ya_kipimo safe to re-apply after a partial/manual run (014 used a
-- bare CREATE TYPE). No-op when the type already exists.
DO $$ BEGIN
  CREATE TYPE aina_ya_kipimo AS ENUM ('katalogi', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
