-- US school grading: assignment categories + weighted categories + letter grades
-- Run once in pgAdmin.

-- Assignment category (for weighted grading)
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'homework';
UPDATE assignments SET category = 'homework' WHERE category IS NULL;

-- Category weights per class (e.g. homework 30%, tests 50%, participation 20%)
CREATE TABLE IF NOT EXISTS class_category_weights (
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  weight_percent NUMERIC(5,2) NOT NULL CHECK (weight_percent >= 0 AND weight_percent <= 100),
  PRIMARY KEY (class_section_id, category)
);
