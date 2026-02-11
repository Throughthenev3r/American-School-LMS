-- Assignments: deadline with time (minute precision).
-- Run once in pgAdmin.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
-- Backfill: existing due_date = end of that day (23:59 UTC)
UPDATE assignments
SET due_at = (due_date::date + time '23:59:59') AT TIME ZONE 'UTC'
WHERE due_at IS NULL AND due_date IS NOT NULL;
