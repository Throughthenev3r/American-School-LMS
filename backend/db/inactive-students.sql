-- Add inactive flag for students (soft-disable without deleting)
ALTER TABLE students ADD COLUMN IF NOT EXISTS inactive BOOLEAN DEFAULT false;
