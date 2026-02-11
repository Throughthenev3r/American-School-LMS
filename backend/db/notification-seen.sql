-- Notifications: "new" classes/assignments until user views the page.
-- Run once in pgAdmin (Query Tool → Execute).

-- When classes/assignments were created (for "new" count)
ALTER TABLE class_sections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
UPDATE class_sections SET created_at = NOW() - interval '1 year' WHERE created_at IS NULL;
UPDATE assignments SET created_at = NOW() - interval '1 year' WHERE created_at IS NULL;

-- When user last viewed Classes / Assignments (per user)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_classes_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_assignments_at TIMESTAMPTZ;
