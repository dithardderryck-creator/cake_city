-- BR-13: submitting a usage report auto-creates a request to Inventory, and
-- resolving that request is the confirmation.
--
-- The request is the thread Inventory works against, so it has to point at the
-- exact sheet it was raised for. Without the link, the confirmation is a queue
-- entry nobody can trace back to the chef's taps, and BR-13's "resolving it is
-- the confirmation" has nothing to resolve.
--
-- The link is per sheet, not per order: an amendment supersedes a sheet and
-- raises a new one (see insertUsageBatch), so a per-order link would leave the
-- old request pointing at a sheet nobody will ever confirm.

ALTER TABLE ombi
  ADD COLUMN IF NOT EXISTS zingumiaji_id integer
  REFERENCES zingumiaji_matumizi(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ombi_zingumiaji_idx ON ombi (zingumiaji_id);

-- One open confirmation request per sheet. Without this, every resubmit would
-- stack another request and Inventory would be asked to confirm the same taps
-- several times. A closed request does not block a new one, so a re-raised
-- sheet after an amendment is fine.
CREATE UNIQUE INDEX IF NOT EXISTS ombi_one_open_confirmation_per_sheet
  ON ombi (zingumiaji_id)
  WHERE zingumiaji_id IS NOT NULL
    AND hali NOT IN ('imekamilika', 'imekataa', 'imeghairi');

COMMENT ON COLUMN ombi.zingumiaji_id IS
  'Set only on the request BR-13 raises when a usage report is submitted. Resolving it confirms the sheet.';
