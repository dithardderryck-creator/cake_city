-- A chef sheet that was replaced before inventory confirmed it.
--
-- Migration 008 allowed one open sheet per order and gave the API a "badilisha"
-- flag for a correction. The implementation detached the old lines and deleted
-- the old sheet, which is the opposite of what the input field promises ("the old
-- one is kept for the record"). A correction therefore erased the submission it
-- was correcting, and the audit trail for a sheet could end up with a hole exactly
-- where somebody changed their mind.
--
-- A third state is the honest model: the sheet is neither pending nor confirmed.
-- It is superseded. The rows stay, with the amounts the chef actually submitted,
-- and the reason it was replaced. The partial unique index in migration 008 keys
-- on hali = 'inakadiriwa', so a superseded sheet does not block the replacement.

ALTER TYPE hali_uthibitisho_matumizi ADD VALUE IF NOT EXISTS 'imebadilishwa';

COMMENT ON TYPE hali_uthibitisho_matumizi IS
  'inakadiriwa = waiting on inventory. imethibitishwa = confirmed, and the only '
  'state in which the lines have moved stock. imebadilishwa = replaced by a later '
  'submission before confirmation; kept for the record, never queued, and never '
  'moved stock.';

-- ── Who wrote the sheet ──────────────────────────────────────────────────────

-- No new column. The chef who submitted a sheet is already recorded in
-- zingumiaji_matumizi.mpishi_id, which is a foreign key to mtumiaji. The name
-- reads as "chef id" and means exactly that; it is only confusing next to the
-- other mpishi_id columns in this schema, which refer to the chef on usage lines.
-- Migration 009 had it right: the sheet records its author, and the pending queue
-- and the chef's own list both key on it.
